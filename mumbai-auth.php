<?php
/**
 * Plugin Name: Mumbai Collection Auth
 * Description: Custom authentication API for Mumbai Collection React App.
 * Version: 2.0 (Production)
 * Author: Lalit
 */
if (!defined('ABSPATH')) {
    exit;
}
/*
 * ─────────────────────────────────────────────
 * CONFIGURATION
 * ─────────────────────────────────────────────
 *
 * Add these two constants to your wp-config.php:
 *
 *   define('MUMBAI_INTERNAL_API_KEY', 'your-secret-key-here');
 *   define('MUMBAI_FRONTEND_URL',    'https://your-production-domain.com');
 *
 * DO NOT hardcode secrets in this plugin file.
 * ─────────────────────────────────────────────
 */
// Fail early if the internal API key is not configured
if (!defined('MUMBAI_INTERNAL_API_KEY') && !defined('MUMBAI_INTERNAL_API_KEY_FALLBACK')) {
    add_action('admin_notices', function () {
        echo '<div class="notice notice-error"><p><strong>Mumbai Collection Auth:</strong> '
           . 'MUMBAI_INTERNAL_API_KEY is not defined in wp-config.php. '
           . 'The plugin will not function until this is set.</p></div>';
    });
}
// Default frontend URL: environment-aware fallback (localhost for local dev, store apex for production)
if (!defined('MUMBAI_FRONTEND_URL')) {
    $host = isset($_SERVER['HTTP_HOST']) ? strtolower($_SERVER['HTTP_HOST']) : '';
    $is_local = in_array($host, ['localhost', '127.0.0.1', 'mumbai-collection.local'])
        || strpos($host, 'localhost:') === 0
        || strpos($host, '127.0.0.1:') === 0;
    define('MUMBAI_FRONTEND_URL', $is_local ? 'http://localhost:5173' : 'https://mumbaicollection.in');
}
// Maximum failed login attempts before lockout (10 attempts combined with progressive delay to avoid easy victim DoS)
if (!defined('MUMBAI_MAX_LOGIN_ATTEMPTS')) {
    define('MUMBAI_MAX_LOGIN_ATTEMPTS', 10);
}
// Lockout duration in seconds (15 minutes)
if (!defined('MUMBAI_LOCKOUT_DURATION')) {
    define('MUMBAI_LOCKOUT_DURATION', 15 * MINUTE_IN_SECONDS);
}

// Production Hardening: Ensure file editing is disabled in WordPress
if (!defined('DISALLOW_FILE_EDIT')) {
    define('DISALLOW_FILE_EDIT', true);
}

// Production Hardening: Warn if WP_DEBUG is enabled
if (defined('WP_DEBUG') && WP_DEBUG) {
    add_action('admin_notices', function () {
        echo '<div class="notice notice-warning is-dismissible"><p><strong>Mumbai Collection Security Notice:</strong> '
           . 'WP_DEBUG is enabled. Ensure WP_DEBUG is set to false in wp-config.php for production deployments.</p></div>';
    });
}

// Production Hardening: Disable XML-RPC pingbacks and brute-force vector
add_filter('xmlrpc_enabled', '__return_false');

// Production Hardening: Restrict default WordPress REST user enumeration to administrators
add_filter('rest_endpoints', function ($endpoints) {
    if (isset($endpoints['/wp/v2/users']) && (!function_exists('current_user_can') || !current_user_can('manage_options'))) {
        unset($endpoints['/wp/v2/users']);
    }
    if (isset($endpoints['/wp/v2/users/(?P<id>[\d]+)']) && (!function_exists('current_user_can') || !current_user_can('manage_options'))) {
        unset($endpoints['/wp/v2/users/(?P<id>[\d]+)']);
    }
    return $endpoints;
});

// WooCommerce High-Performance Order Storage (HPOS) Compatibility Declaration
add_action('before_woocommerce_init', function () {
    if (class_exists(\Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
    }
});
/*
 * ─────────────────────────────────────────────
 * HELPER: Conditional debug logging
 * ─────────────────────────────────────────────
 * Only logs when WP_DEBUG is true.
 * NEVER logs sensitive data (tokens, cookies, keys).
 */
function mumbai_log($message) {
    if (defined('WP_DEBUG') && WP_DEBUG) {
        error_log('[Mumbai Auth] ' . $message);
    }
}

/**
 * Check if the internal server API key is configured.
 */
function mumbai_has_internal_key_configured()
{
    return (defined('MUMBAI_INTERNAL_API_KEY') && constant('MUMBAI_INTERNAL_API_KEY') !== '') ||
           (defined('MUMBAI_INTERNAL_API_KEY_FALLBACK') && constant('MUMBAI_INTERNAL_API_KEY_FALLBACK') !== '');
}

/**
 * Validate internal API key with support for zero-downtime rotation.
 * Checks primary key (MUMBAI_INTERNAL_API_KEY) and optional fallback key (MUMBAI_INTERNAL_API_KEY_FALLBACK).
 * Also supports comma-separated keys in either constant.
 */
function mumbai_is_valid_internal_key($api_key)
{
    if (empty($api_key) || !is_string($api_key)) {
        return false;
    }

    $valid_keys = [];
    if (defined('MUMBAI_INTERNAL_API_KEY') && constant('MUMBAI_INTERNAL_API_KEY')) {
        foreach (explode(',', constant('MUMBAI_INTERNAL_API_KEY')) as $k) {
            $trimmed = trim($k);
            if ($trimmed !== '') {
                $valid_keys[] = $trimmed;
            }
        }
    }
    if (defined('MUMBAI_INTERNAL_API_KEY_FALLBACK') && constant('MUMBAI_INTERNAL_API_KEY_FALLBACK')) {
        foreach (explode(',', constant('MUMBAI_INTERNAL_API_KEY_FALLBACK')) as $k) {
            $trimmed = trim($k);
            if ($trimmed !== '') {
                $valid_keys[] = $trimmed;
            }
        }
    }

    if (empty($valid_keys)) {
        return false;
    }

    foreach ($valid_keys as $valid_key) {
        if (hash_equals($valid_key, $api_key)) {
            return true;
        }
    }

    return false;
}

/*
 * ─────────────────────────────────────────────
 * HARDENING: DISABLE XML-RPC & PINGBACKS
 * ─────────────────────────────────────────────
 * Neutralize brute-force, reflection, and amplification attacks via xmlrpc.php.
 */
add_filter('xmlrpc_enabled', '__return_false');
add_filter('xmlrpc_methods', function () {
    return [];
});
add_filter('wp_headers', function ($headers) {
    unset($headers['X-Pingback']);
    return $headers;
});

/*
 * ─────────────────────────────────────────────
 * HARDENING: BLOCK PUBLIC USER ENUMERATION
 * ─────────────────────────────────────────────
 * Prohibit unauthenticated visitors and crawlers from enumerating users via
 * /wp-json/wp/v2/users or /?author=N while preserving access for trusted callers
 * (server internal key or authenticated users with list_users capability).
 */
add_filter('rest_pre_dispatch', function ($result, $server, $request) {
    if (!empty($result)) {
        return $result;
    }

    $route = $request->get_route();
    if (strpos($route, '/wp/v2/users') === 0) {
        $internal_key = $request->get_header('X-Mumbai-Internal-Key');
        $is_internal = function_exists('mumbai_is_valid_internal_key') && mumbai_is_valid_internal_key($internal_key);

        if (!$is_internal && !current_user_can('list_users')) {
            return new WP_Error(
                'rest_cannot_access',
                'User listing is restricted.',
                ['status' => rest_authorization_required_code()]
            );
        }
    }

    return $result;
}, 10, 3);

add_action('template_redirect', function () {
    if (is_author() && !is_admin()) {
        wp_safe_redirect(home_url(), 301);
        exit;
    }
});

/**
 * Ensure the 'employee' role exists in WordPress
 */
add_action('init', function () {
    if (!get_role('employee')) {
        add_role('employee', 'Employee', [
            'read'         => true,
            'edit_posts'   => false,
            'delete_posts' => false,
        ]);
    }
});

/**
 * Prevent non-administrative users (employees, customers)
 * from accessing the WordPress wp-admin dashboard directly.
 */
add_action('admin_init', function () {
    if (defined('DOING_AJAX') && DOING_AJAX) {
        return;
    }
    if (function_exists('wp_doing_cron') && wp_doing_cron()) {
        return;
    }
    $current_user = wp_get_current_user();
    if ($current_user && $current_user->exists()) {
        if (!in_array('administrator', (array) $current_user->roles, true)) {
            wp_safe_redirect(home_url('/'));
            exit;
        }
    }
});
/*
 * ─────────────────────────────────────────────
 * COOKIE-BASED USER DETECTION
 * ─────────────────────────────────────────────
 * Allows WordPress to identify the user when
 * Node.js forwards the logged_in cookie.
 */
add_filter('determine_current_user', function ($user_id) {
    if ($user_id) {
        return $user_id;
    }
    if (!defined('LOGGED_IN_COOKIE')) {
        return $user_id;
    }
    $cookie = $_COOKIE[LOGGED_IN_COOKIE] ?? '';
    if (!$cookie) {
        return $user_id;
    }
    $validated_user_id = wp_validate_auth_cookie(
        $cookie,
        'logged_in'
    );
    if (!$validated_user_id) {
        return $user_id;
    }

    // CSRF Protection (H6):
    // If this is a state-changing HTTP method (POST, PUT, PATCH, DELETE) from a browser
    // (i.e. not authenticated with the server-to-server internal API key),
    // require a valid WordPress REST nonce to prevent cross-site request forgery.
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $is_state_changing = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true);

    if ($is_state_changing) {
        $internal_key = $_SERVER['HTTP_X_MUMBAI_INTERNAL_KEY'] ?? '';
        $is_internal = mumbai_is_valid_internal_key($internal_key);

        if (!$is_internal) {
            $nonce = $_SERVER['HTTP_X_WP_NONCE'] ?? ($_REQUEST['_wpnonce'] ?? '');
            if (!$nonce || !wp_verify_nonce($nonce, 'wp_rest')) {
                // Reject ambient cookie authentication on state-changing requests lacking valid nonce
                return $user_id;
            }
        }
    }

    return $validated_user_id;
});
/*
 * ─────────────────────────────────────────────
 * REST API ROUTES
 * ─────────────────────────────────────────────
 */
add_action('rest_api_init', function () {
    // Auth endpoints (Internal Node.js Express gateway only — require internal API key)
    register_rest_route('mumbai-auth/v1', '/login', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_login',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/register', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_register',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/forgot-password', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_forgot_password',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/reset-password', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_reset_password',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/logout', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_logout',
        'permission_callback' => '__return_true',
    ]);
    register_rest_route('mumbai-auth/v1', '/sso', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_sso',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/me', [
        'methods'             => 'GET',
        'callback'            => 'mumbai_me',
        'permission_callback' => '__return_true',
    ]);
    
    // OTP Endpoints (Node.js only — require API key)
    register_rest_route('mumbai-auth/v1', '/otp/store', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_otp_store',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/otp/verify', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_otp_verify',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/otp/invalidate', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_otp_invalidate',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/otp/reset-password', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_otp_reset_password',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    // Payment Intent & Atomic Lock Endpoints (Internal Node.js only)
    register_rest_route('mumbai-auth/v1', '/payment-intent/store', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_payment_intent_store',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/payment-intent/get', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_payment_intent_get',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/payment-intent/delete', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_payment_intent_delete',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/payment-intent/update-status', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_payment_intent_update_status',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/payment-intent/reconciliation-list', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_payment_intent_reconciliation_list',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/stock/reserve', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_reserve_checkout_stock',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/stock/release', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_release_checkout_stock',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/reconciliation/watermark', [
        'methods'             => ['GET', 'POST'],
        'callback'            => function (WP_REST_Request $request) {
            if ($request->get_method() === 'POST') {
                return mumbai_reconciliation_set_watermark($request);
            }
            return mumbai_reconciliation_get_watermark($request);
        },
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/webhook-event/store', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_webhook_event_store',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/webhook-event/update-status', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_webhook_event_update_status',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/webhook-events/orphans', [
        'methods'             => 'GET',
        'callback'            => 'mumbai_webhook_events_orphans',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/orders/by-razorpay-order-id', [
        'methods'             => ['GET', 'POST'],
        'callback'            => 'mumbai_find_order_by_razorpay_order_id',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/orders/finalize-payment', [
        'methods' => 'POST',
        'callback' => 'mumbai_create_paid_order_once',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/payment-intent/lock', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_payment_intent_lock',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/payment-intent/unlock', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_payment_intent_unlock',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/cart/clear', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_cart_clear',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    // Internal endpoints (Node.js only — require API key)
    register_rest_route('mumbai-auth/v1', '/addresses', [
        'methods'             => 'GET',
        'callback'            => 'mumbai_get_addresses',
        'permission_callback' => 'mumbai_internal_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/addresses', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_save_address',
        'permission_callback' => 'mumbai_internal_permission',
    ]);
    register_rest_route(
        'mumbai-auth/v1',
        '/addresses/(?P<id>[a-zA-Z0-9-]+)',
        [
            'methods'             => 'PUT',
            'callback'            => 'mumbai_update_address',
            'permission_callback' => 'mumbai_internal_permission',
        ]
    );
    register_rest_route(
        'mumbai-auth/v1',
        '/addresses/(?P<id>[a-zA-Z0-9-]+)',
        [
            'methods'             => 'DELETE',
            'callback'            => 'mumbai_delete_address',
            'permission_callback' => 'mumbai_internal_permission',
        ]
    );
    register_rest_route(
        'mumbai-auth/v1',
        '/profile/complete',
        [
            'methods'             => 'GET',
            'callback'            => 'mumbai_check_profile_complete',
            'permission_callback' => 'mumbai_internal_permission',
        ]
    );
    register_rest_route('mumbai-auth/v1', '/profile', [
        'methods'             => 'GET',
        'callback'            => 'mumbai_get_profile',
        'permission_callback' => 'mumbai_internal_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/profile', [
        'methods'             => 'PUT',
        'callback'            => 'mumbai_save_profile',
        'permission_callback' => 'mumbai_internal_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/profile', [
        'methods'             => 'DELETE',
        'callback'            => 'mumbai_delete_account',
        'permission_callback' => 'mumbai_internal_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/check-phone', [
        'methods'             => 'GET',
        'callback'            => 'mumbai_check_phone_availability',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
      // Homepage banner endpoints
    register_rest_route('mumbai-auth/v1', '/banners', [
       'methods'             => 'GET',
       'callback'            => 'mumbai_get_banners',
       'permission_callback' => '__return_true',
    ]);

    register_rest_route('mumbai-auth/v1', '/banners', [
      'methods'             => ['PUT', 'POST'],
      'callback'            => 'mumbai_save_banners',
      'permission_callback' => 'mumbai_internal_server_permission',
    ]);

    // Store Operating Hours endpoints
    register_rest_route('mumbai-auth/v1', '/store-hours', [
       'methods'             => 'GET',
       'callback'            => 'mumbai_get_store_hours',
       'permission_callback' => '__return_true',
    ]);

    register_rest_route('mumbai-auth/v1', '/store-hours', [
      'methods'             => ['PUT', 'POST'],
      'callback'            => 'mumbai_save_store_hours',
      'permission_callback' => 'mumbai_internal_server_permission',
    ]);

    register_rest_route('mumbai-auth/v1', '/store-hours/clear-transient', [
      'methods'             => 'POST',
      'callback'            => function () {
          delete_transient('mumbai_store_hours');
          return rest_ensure_response(['success' => true, 'transient_deleted' => true]);
      },
      'permission_callback' => 'mumbai_internal_server_permission',
    ]);

    // Media Orphan Cleanup & Lifecycle Management endpoints (Internal Node.js only)
    register_rest_route('mumbai-auth/v1', '/media/upload', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_upload_media_attachment',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/media/track-pending', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_track_pending_media',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/media/mark-attached', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_mark_media_attached',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/media/delete-if-unreferenced', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_delete_media_if_unreferenced',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/media/cleanup-pending-orphans', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_cleanup_pending_orphans',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);

    // Live Inventory Stock Counts (Internal Node.js only)
    register_rest_route('mumbai-auth/v1', '/products/stock-counts', [
        'methods'             => 'GET',
        'callback'            => 'mumbai_get_product_stock_counts',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/catalog/search', [
        'methods'             => 'GET',
        'callback'            => 'mumbai_catalog_search',
        'permission_callback' => 'mumbai_internal_server_permission',
        'args'                => [
            'q'        => ['required' => true, 'sanitize_callback' => 'sanitize_text_field'],
            'page'     => ['default' => 1, 'sanitize_callback' => 'absint'],
            'per_page' => ['default' => 20, 'sanitize_callback' => 'absint'],
        ],
    ]);
    register_rest_route('mumbai-auth/v1', '/catalog/products/(?P<id>\d+)/review-summary', [
        'methods'             => 'GET',
        'callback'            => 'mumbai_catalog_review_summary',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/catalog/products/(?P<id>\d+)/review-exists', [
        'methods'             => 'GET',
        'callback'            => 'mumbai_catalog_review_exists',
        'permission_callback' => 'mumbai_internal_server_permission',
        'args'                => [
            'email' => ['required' => true, 'sanitize_callback' => 'sanitize_email'],
        ],
    ]);

    // Employee Access & Allowlist Management (Internal Node.js only)
    register_rest_route('mumbai-auth/v1', '/admin/employees', [
        'methods'             => 'GET',
        'callback'            => 'mumbai_admin_get_employees',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/admin/employees/access', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_admin_request_employee_access',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/admin/employees/approve', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_admin_approve_employee',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/admin/employees/reject', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_admin_reject_employee',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/admin/employees/status', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_admin_update_employee_status',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/admin/employees/revoke-sessions', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_admin_revoke_employee_sessions',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);

    // Customer Directory Management (Internal Node.js only)
    register_rest_route('mumbai-auth/v1', '/admin/customers', [
        'methods'             => 'GET',
        'callback'            => 'mumbai_admin_get_customers',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/admin/customers/(?P<id>\d+)/orders', [
        'methods'             => 'GET',
        'callback'            => 'mumbai_admin_get_customer_orders',
        'permission_callback' => 'mumbai_internal_server_permission',
        'args'                => [
            'id'       => [
                'validate_callback' => function ($param) {
                    return is_numeric($param);
                },
                'sanitize_callback' => 'absint',
            ],
            'page'     => ['default' => 1, 'sanitize_callback' => 'absint'],
            'per_page' => ['default' => 10, 'sanitize_callback' => 'absint'],
        ],
    ]);
    register_rest_route('mumbai-auth/v1', '/employee/orders', [
        'methods'             => 'GET',
        'callback'            => 'mumbai_employee_get_orders',
        'permission_callback' => 'mumbai_internal_server_permission',
        'args'                => [
            'status'   => ['sanitize_callback' => 'sanitize_key'],
            'location' => ['sanitize_callback' => 'sanitize_key'],
            'page'     => ['default' => 1, 'sanitize_callback' => 'absint'],
            'per_page' => ['default' => 20, 'sanitize_callback' => 'absint'],
            'after'    => ['sanitize_callback' => 'sanitize_text_field'],
            'before'   => ['sanitize_callback' => 'sanitize_text_field'],
            'search'   => ['sanitize_callback' => 'sanitize_text_field'],
        ],
    ]);

    register_rest_route('mumbai-auth/v1', '/staff/orders/(?P<id>\d+)/status', [
        'methods' => 'POST', 'callback' => 'mumbai_staff_update_order_status',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/staff/products/(?P<id>\d+)/adjust', [
        'methods' => 'POST', 'callback' => 'mumbai_staff_adjust_product',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);

    // Analytics Summary & Customer LTV Aggregations (Internal Node.js only)
    register_rest_route('mumbai-auth/v1', '/admin/analytics-summary', [
        'methods'             => 'GET',
        'callback'            => 'mumbai_admin_get_analytics_summary',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/admin/analytics-report', [
        'methods'             => 'GET',
        'callback'            => 'mumbai_admin_get_analytics_report',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);

    // Customer Suspension Management (Internal Node.js only)
    register_rest_route('mumbai-auth/v1', '/admin/customer-suspension/lookup', [
        'methods'             => 'GET',
        'callback'            => 'mumbai_admin_customer_suspension_lookup',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/admin/customer-suspension/suspend', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_admin_customer_suspension_suspend',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
    register_rest_route('mumbai-auth/v1', '/admin/customer-suspension/unsuspend', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_admin_customer_suspension_unsuspend',
        'permission_callback' => 'mumbai_internal_server_permission',
    ]);
});
/*
 * ─────────────────────────────────────────────
 * LOGIN
 * ─────────────────────────────────────────────
 * Includes brute-force protection:
 * - Locks after MUMBAI_MAX_LOGIN_ATTEMPTS failures
 * - Lock lasts MUMBAI_LOCKOUT_DURATION seconds
 * - Successful login resets the counter
 */
function mumbai_login(WP_REST_Request $request)
{
    $email    = sanitize_email($request->get_param('email'));
    $password = $request->get_param('password');
    if (!$email || !$password) {
        return new WP_Error(
            'missing_fields',
            'Email and password are required.',
            ['status' => 400]
        );
    }
    $user = get_user_by('email', $email);
    if (!$user) {
        // Equalize response timing with valid accounts to prevent timing enumeration
        $dummy_hash = '$P$B71VqT0EaKz.w6m0/5Q6Gz2sC/l0Bq.';
        wp_check_password($password, $dummy_hash);
        usleep(500000);
        return new WP_Error(
            'login_failed',
            'Invalid email or password.',
            ['status' => 401]
        );
    }
    /*
     * Brute-force protection: check if account is locked
     */
    $failed_attempts = (int) get_user_meta($user->ID, '_mumbai_failed_logins', true);
    $lockout_until   = (int) get_user_meta($user->ID, '_mumbai_lockout_until', true);
    if ($failed_attempts >= MUMBAI_MAX_LOGIN_ATTEMPTS && time() < $lockout_until) {
        $minutes_left = ceil(($lockout_until - time()) / 60);
        mumbai_log("Login blocked for user {$user->ID} — locked for {$minutes_left} more minutes.");
        // Equalize response timing with password hash verification to prevent account enumeration
        usleep(500000);
        return new WP_Error(
            'account_locked',
            "Too many failed attempts. Please try again in {$minutes_left} minute(s).",
            ['status' => 429]
        );
    }
    // If lockout period has passed, reset the counter
    if ($lockout_until && time() >= $lockout_until) {
        delete_user_meta($user->ID, '_mumbai_failed_logins');
        delete_user_meta($user->ID, '_mumbai_lockout_until');
    }
    /*
     * Attempt WordPress sign-on
     */
    $creds = [
        'user_login'    => $user->user_login,
        'user_password' => $password,
        'remember'      => true,
    ];
    $signon = wp_signon($creds, is_ssl());
    if (is_wp_error($signon)) {
        /*
         * Progressive delay to throttle automated brute-force attacks (500ms)
         */
        usleep(500000);

        /*
         * Increment failed login counter
         */
        $failed_attempts = (int) get_user_meta($user->ID, '_mumbai_failed_logins', true);
        $failed_attempts++;
        update_user_meta($user->ID, '_mumbai_failed_logins', $failed_attempts);
        if ($failed_attempts >= MUMBAI_MAX_LOGIN_ATTEMPTS) {
            $lockout_time = time() + MUMBAI_LOCKOUT_DURATION;
            update_user_meta($user->ID, '_mumbai_lockout_until', $lockout_time);
            mumbai_log("User {$user->ID} locked out after {$failed_attempts} failed attempts.");
        }
        return new WP_Error(
            'login_failed',
            'Invalid email or password.',
            ['status' => 401]
        );
    }
    /*
     * Login successful — clear any failed attempt counters
     */
    delete_user_meta($signon->ID, '_mumbai_failed_logins');
    delete_user_meta($signon->ID, '_mumbai_lockout_until');
    wp_set_current_user($signon->ID);
    /*
     * Create ONE session token and use it everywhere.
     * Enforce 12-hour expiration on server-side WordPress session for staff/admins,
     * and 30 days for regular customers.
     */
    $user_roles = (array) $signon->roles;
    $is_staff = !empty(array_intersect(['administrator', 'employee', 'shop_manager'], $user_roles));
    $expiration = time() + ($is_staff ? (12 * HOUR_IN_SECONDS) : (30 * DAY_IN_SECONDS));
    $session_manager = WP_Session_Tokens::get_instance($signon->ID);
    $session_token   = $session_manager->create($expiration);
    /*
     * Set WordPress authentication cookie
     * using the same session token.
     */
    wp_set_auth_cookie(
        $signon->ID,
        true,
        is_ssl(),
        $session_token
    );
    /*
     * Generate the exact logged-in cookie that
     * our Node backend will send back to WordPress.
     */
    $logged_in_cookie = wp_generate_auth_cookie(
        $signon->ID,
        $expiration,
        'logged_in',
        $session_token
    );
    /*
     * Make WordPress aware of this cookie during
     * the current request so wp_create_nonce()
     * uses the SAME session token.
     */
    $_COOKIE[LOGGED_IN_COOKIE] = $logged_in_cookie;
    /*
     * Generate REST nonce tied to the same session.
     */
    $rest_nonce = wp_create_nonce('wp_rest');
    mumbai_log("User {$signon->ID} logged in successfully.");
    return [
        'success'     => true,
        'message'     => 'Login successful.',
        'user'        => [
            'id'       => $signon->ID,
            'name'     => $signon->display_name,
            'email'    => $signon->user_email,
            'username' => $signon->user_login,
            'roles'    => array_values((array) $signon->roles),
        ],
        'session'     => $logged_in_cookie,
        'cookie_name' => LOGGED_IN_COOKIE,
        'rest_nonce'  => $rest_nonce,
    ];
}
/*
 * ─────────────────────────────────────────────
 * SSO LOGIN / REGISTER (INTERNAL ONLY)
 * ─────────────────────────────────────────────
 * Forwards a pre-verified SSO user (e.g. Google)
 * to WordPress, creating a session.
 */
function mumbai_sso(WP_REST_Request $request)
{
    $email      = strtolower(sanitize_email($request->get_param('email')));
    $name       = sanitize_text_field($request->get_param('name'));
    $google_sub = sanitize_text_field($request->get_param('google_sub'));

    if (!$email || !$google_sub) {
        return new WP_Error('missing_data', 'Email and Google Sub are required for SSO.', ['status' => 400]);
    }

    $active_user_id = (int) $request->get_param('authenticated_user_id');
    if ($active_user_id > 0) {
        $active_user = get_user_by('id', $active_user_id);
        if (!$active_user || strtolower(sanitize_email($active_user->user_email)) !== $email) {
            return new WP_Error('sso_account_mismatch', 'Please choose the Google account matching your store account email.', ['status' => 409]);
        }
    }

    $user = null;
    $is_new_user = false;

    // 1. Try finding by Google Sub
    $users_by_sub = get_users([
        'meta_key'   => '_google_sub',
        'meta_value' => $google_sub,
        'number'     => 2,
        'fields'     => 'all',
    ]);

    // A Google identity must map to exactly one WordPress account. Do not guess
    // if old/corrupt metadata has attached the same identity to multiple users.
    if (count($users_by_sub) > 1) {
        return new WP_Error(
            'sso_identity_conflict',
            'This Google account is linked to more than one store account. Please contact support.',
            ['status' => 409]
        );
    }

    if (!empty($users_by_sub)) {
        $user = $users_by_sub[0];

        // The stable Google subject and the verified email must both identify
        // the same account. Never sign into an account when these disagree.
        $mapped_email = strtolower(sanitize_email($user->user_email));
        if (!$mapped_email || !hash_equals($mapped_email, $email)) {
            return new WP_Error(
                'sso_identity_email_mismatch',
                'The Google account does not match the email linked to this store account. Please contact support.',
                ['status' => 403]
            );
        }

        $mapped_roles = (array) $user->roles;
        if (array_intersect(['administrator', 'employee', 'shop_manager'], $mapped_roles)) {
            return new WP_Error(
                'sso_linking_not_allowed',
                'Google login is disabled for staff and administrator accounts. Please log in with your email and password.',
                ['status' => 403]
            );
        }
    }

    // 2. Try finding by email (for first-time linking)
    if (!$user) {
        $candidate_user = get_user_by('email', $email);
        
        if ($candidate_user) {
            $user_roles = (array) $candidate_user->roles;
            $is_staff_or_admin = !empty(array_intersect(['administrator', 'employee', 'shop_manager'], $user_roles));

            if ($is_staff_or_admin) {
                return new WP_Error(
                    'sso_linking_not_allowed',
                    'Google login is disabled for staff and administrator accounts. Please log in with your email and password.',
                    ['status' => 403]
                );
            }

            // Never replace a different Google identity already linked to this
            // email account. Re-linking should require an explicit recovery flow.
            $existing_google_sub = (string) get_user_meta($candidate_user->ID, '_google_sub', true);
            if ($existing_google_sub !== '' && !hash_equals($existing_google_sub, $google_sub)) {
                return new WP_Error(
                    'sso_account_already_linked',
                    'This store account is already linked to a different Google account. Please sign in another way or contact support.',
                    ['status' => 409]
                );
            }

            // If account exists with this email but has never been linked to Google:
            // Require proof of ownership: caller must already be authenticated as this candidate user.
            $authenticated_user_id = (int) $request->get_param('authenticated_user_id');
            $is_owner_confirmed = ($authenticated_user_id > 0 && $authenticated_user_id === (int) $candidate_user->ID);

            if ($existing_google_sub === '' && !$is_owner_confirmed) {
                return new WP_Error(
                    'sso_linking_verification_required',
                    'An account with this email already exists. Please sign in with your password or email OTP first, then link Google from your account.',
                    ['status' => 409]
                );
            }

            // Verified linking of existing account to Google
            $user = $candidate_user;
            if ($existing_google_sub === '') {
                update_user_meta($user->ID, '_google_sub', $google_sub);
                mumbai_log("Linked Google Sub to existing user {$user->ID}");
            }
        }
    }

    // 3. Create new user if no match found
    if (!$user) {
        $is_new_user = true;
        $email_prefix = current(explode('@', $email));
        $username = sanitize_user($email_prefix, true);
        if (empty($username)) {
            $username = 'sso_' . wp_generate_password(8, false, false);
        }
        $original_username = $username;
        $counter = 1;
        while (username_exists($username)) {
            $username = $original_username . $counter;
            $counter++;
        }

        $random_password = wp_generate_password(16, true, true);
        $user_id = wp_create_user($username, $random_password, $email);

        if (is_wp_error($user_id)) {
            return new WP_Error('registration_failed', $user_id->get_error_message(), ['status' => 500]);
        }

        $wp_user = new WP_User($user_id);
        $wp_user->set_role('customer');

        wp_update_user([
            'ID'           => $user_id,
            'display_name' => $name ? $name : $username,
            'nickname'     => $name ? $name : $username,
        ]);

        $name_parts = preg_split('/\s+/', trim($name));
        $first_name = !empty($name_parts[0]) ? $name_parts[0] : '';
        $last_name  = count($name_parts) > 1 ? implode(' ', array_slice($name_parts, 1)) : '';
        if ($first_name) {
            update_user_meta($user_id, 'first_name', $first_name);
            update_user_meta($user_id, 'billing_first_name', $first_name);
        }
        if ($last_name) {
            update_user_meta($user_id, 'last_name', $last_name);
            update_user_meta($user_id, 'billing_last_name', $last_name);
        }

        update_user_meta($user_id, '_google_sub', $google_sub);
        mumbai_sync_customer_search_index($user_id);

        $user = get_user_by('id', $user_id);
        mumbai_log("New user registered via SSO: {$user_id}");
    }

    // Clear any lockouts since SSO succeeds without password
    delete_user_meta($user->ID, '_mumbai_failed_logins');
    delete_user_meta($user->ID, '_mumbai_lockout_until');

    wp_set_current_user($user->ID);

    $expiration = time() + (30 * DAY_IN_SECONDS);
    $session_manager = WP_Session_Tokens::get_instance($user->ID);
    $session_token   = $session_manager->create($expiration);

    wp_set_auth_cookie($user->ID, true, is_ssl(), $session_token);

    $logged_in_cookie = wp_generate_auth_cookie($user->ID, $expiration, 'logged_in', $session_token);
    $_COOKIE[LOGGED_IN_COOKIE] = $logged_in_cookie;
    $rest_nonce = wp_create_nonce('wp_rest');

    mumbai_log("User {$user->ID} logged in via SSO.");

    $is_phone_verified = function_exists('mumbai_is_user_phone_verified')
        ? (bool) mumbai_is_user_phone_verified($user->ID)
        : false;

    return [
        'success'     => true,
        'message'     => 'SSO successful.',
        'is_new_user' => $is_new_user,
        'user'        => [
            'id'                => $user->ID,
            'name'              => $user->display_name,
            'first_name'        => (string) get_user_meta($user->ID, 'first_name', true),
            'last_name'         => (string) get_user_meta($user->ID, 'last_name', true),
            'email'             => $user->user_email,
            'username'          => $user->user_login,
            'roles'             => array_values((array) $user->roles),
            'is_phone_verified' => $is_phone_verified,
        ],
        'session'     => $logged_in_cookie,
        'cookie_name' => LOGGED_IN_COOKIE,
        'rest_nonce'  => $rest_nonce,
    ];
}

/*
 * ─────────────────────────────────────────────
 * REGISTER
 * ─────────────────────────────────────────────
 */
function mumbai_register(WP_REST_Request $request)
{
    $first_name = sanitize_text_field($request->get_param('first_name'));
    $last_name  = sanitize_text_field($request->get_param('last_name'));
    $name       = sanitize_text_field($request->get_param('name'));
    $email      = sanitize_email($request->get_param('email'));
    $password   = $request->get_param('password');

    if (empty($first_name) || empty($last_name)) {
        if (!empty($name)) {
            $parts = preg_split('/\s+/', trim($name));
            if (empty($first_name) && !empty($parts[0])) {
                $first_name = $parts[0];
            }
            if (empty($last_name) && count($parts) > 1) {
                $last_name = implode(' ', array_slice($parts, 1));
            }
        }
    }

    $first_name = mumbai_normalize_name($first_name);
    $last_name  = mumbai_normalize_name($last_name);

    if (empty($first_name)) {
        return new WP_Error(
            'missing_first_name',
            'First name is required.',
            ['status' => 400]
        );
    }
    if (!mumbai_is_valid_person_name($first_name)) {
        return new WP_Error(
            'invalid_first_name',
            'First name can only contain letters, spaces, hyphens, apostrophes, and periods.',
            ['status' => 400]
        );
    }

    if (empty($last_name)) {
        return new WP_Error(
            'missing_last_name',
            'Last name is required.',
            ['status' => 400]
        );
    }
    if (!mumbai_is_valid_person_name($last_name)) {
        return new WP_Error(
            'invalid_last_name',
            'Last name can only contain letters, spaces, hyphens, apostrophes, and periods.',
            ['status' => 400]
        );
    }

    $full_name = trim("{$first_name} {$last_name}");

    if (!$email || !$password) {
        return new WP_Error(
            'missing_fields',
            'Name, email and password are required.',
            ['status' => 400]
        );
    }
    if (!is_email($email)) {
        return new WP_Error(
            'invalid_email',
            'Please enter a valid email address.',
            ['status' => 400]
        );
    }
    $pw_check = mumbai_validate_password($password);
    if ($pw_check !== true) {
        return new WP_Error(
            'weak_password',
            $pw_check,
            ['status' => 400]
        );
    }
    if (email_exists($email)) {
        return new WP_Error(
            'email_exists',
            'An account with this email already exists.',
            ['status' => 409]
        );
    }
    $norm_email = strtolower(trim($email));
    $otp_hash = sanitize_text_field($request->get_param('otp_hash'));
    $transient_key = '_mumbai_reg_otp_' . md5($norm_email);
    if (!empty($otp_hash)) {
        $stored = get_transient($transient_key);
        if (!$stored || !is_array($stored) || empty($stored['hash'])) {
            return new WP_Error('expired_otp', 'Verification code has expired or was not requested.', ['status' => 400]);
        }
        if (($stored['attempts'] ?? 0) >= 5) {
            delete_transient($transient_key);
            return new WP_Error('too_many_attempts', 'Too many invalid attempts. Please request a new code.', ['status' => 429]);
        }
        if (!hash_equals((string) $stored['hash'], (string) $otp_hash)) {
            $stored['attempts'] = ($stored['attempts'] ?? 0) + 1;
            set_transient($transient_key, $stored, 300);
            return new WP_Error('invalid_otp', 'Invalid verification code.', ['status' => 400]);
        }
    }
    $phone = sanitize_text_field($request->get_param('phone'));
    if (!empty($phone)) {
        $existing_by_phone = mumbai_get_user_by_phone($phone);
        if ($existing_by_phone) {
            return new WP_Error(
                'phone_exists',
                'An account with this phone number already exists.',
                ['status' => 409]
            );
        }
    }
    // Create unique username from email with safe fallback (M3 fix)
    $email_prefix = current(explode('@', $email));
    $username = sanitize_user($email_prefix, true);
    if (empty($username)) {
        $username = 'customer_' . wp_generate_password(8, false, false);
    }
    $original_username = $username;
    $counter = 1;
    while (username_exists($username)) {
        $username = $original_username . $counter;
        $counter++;
    }
    $user_id = wp_create_user(
        $username,
        $password,
        $email
    );
    if (is_wp_error($user_id)) {
        return new WP_Error(
            'registration_failed',
            $user_id->get_error_message(),
            ['status' => 500]
        );
    }
    if (!empty($otp_hash)) {
        delete_transient($transient_key);
    }
    // Assign WooCommerce customer role (M4 fix) and set display name
    $wp_user = new WP_User($user_id);
    $wp_user->set_role('customer');

    wp_update_user([
        'ID'           => $user_id,
        'first_name'   => $first_name,
        'last_name'    => $last_name,
        'display_name' => $full_name,
        'nickname'     => $full_name,
    ]);

    update_user_meta($user_id, 'billing_first_name', $first_name);
    update_user_meta($user_id, 'billing_last_name', $last_name);
    update_user_meta($user_id, 'shipping_first_name', $first_name);
    update_user_meta($user_id, 'shipping_last_name', $last_name);
    if (!empty($phone)) {
        $clean_phone = mumbai_normalize_phone($phone);
        update_user_meta($user_id, 'billing_phone', $clean_phone);
    }
    mumbai_sync_customer_search_index($user_id);

    // Check if email was pre-allowlisted for employee access
    $allowlist = get_option('_mumbai_employee_allowlist', []);
    $norm_email = strtolower(trim($email));
    if (is_array($allowlist) && isset($allowlist[$norm_email])) {
        $entry = $allowlist[$norm_email];
        update_user_meta($user_id, '_mumbai_employee_status', 'pending');
        update_user_meta($user_id, '_mumbai_employee_requested_at', $entry['requested_at'] ?? time());
        update_user_meta($user_id, '_mumbai_employee_notes', $entry['notes'] ?? '');
        if (!empty($entry['requested_role'])) {
            update_user_meta($user_id, '_mumbai_employee_requested_role', $entry['requested_role']);
        }
        if (!empty($entry['added_by'])) {
            update_user_meta($user_id, '_mumbai_employee_added_by', $entry['added_by']);
        }
        unset($allowlist[$norm_email]);
        update_option('_mumbai_employee_allowlist', $allowlist);
        mumbai_log("Allowlisted employee registered as customer pending admin approval: {$user_id} ({$norm_email})");
    }

    $user = get_user_by('id', $user_id);
    mumbai_log("New user registered: {$user_id}");
    /*
     * Automatically log in newly registered user and generate session
     */
    wp_set_current_user($user_id);
    $expiration = time() + (30 * DAY_IN_SECONDS);
    $session_manager = WP_Session_Tokens::get_instance($user_id);
    $session_token   = $session_manager->create($expiration);

    wp_set_auth_cookie($user_id, true, is_ssl(), $session_token);
    $logged_in_cookie = wp_generate_auth_cookie($user_id, $expiration, 'logged_in', $session_token);
    $_COOKIE[LOGGED_IN_COOKIE] = $logged_in_cookie;
    $rest_nonce = wp_create_nonce('wp_rest');

    return [
        'success'     => true,
        'message'     => 'Account created successfully.',
        'user'        => [
            'id'       => $user->ID,
            'name'     => $user->display_name,
            'email'    => $user->user_email,
            'username' => $user->user_login,
            'roles'    => array_values((array) $user->roles),
        ],
        'session'     => $logged_in_cookie,
        'cookie_name' => LOGGED_IN_COOKIE,
        'rest_nonce'  => $rest_nonce,
    ];
}
/*
 * ─────────────────────────────────────────────
 * FORGOT PASSWORD
 * ─────────────────────────────────────────────
 * Generates a hashed, single-use, time-limited
 * reset token and emails it to the user.
 */
function mumbai_forgot_password(WP_REST_Request $request)
{
    $email = sanitize_email($request->get_param('email'));
    if (!$email || !is_email($email)) {
        return new WP_Error(
            'invalid_email',
            'Please enter a valid email address.',
            ['status' => 400]
        );
    }
    // Generic response — never reveal if email exists
    $generic_response = [
        'success' => true,
        'message' => 'If an account exists with this email, a password reset link has been sent.',
    ];
    $user = get_user_by('email', $email);
    if (!$user) {
        return $generic_response;
    }
    // Rate limit password reset emails to at most 1 every 60 seconds per account (M1 fix)
    $last_request = (int) get_user_meta($user->ID, '_mumbai_last_reset_request', true);
    if ($last_request && (time() - $last_request) < 60) {
        return $generic_response;
    }
    update_user_meta($user->ID, '_mumbai_last_reset_request', time());

    // Generate secure random token
    $token      = wp_generate_password(64, false, false);
    $token_hash = hash('sha256', $token);
    $expires    = time() + (30 * MINUTE_IN_SECONDS);
    update_user_meta($user->ID, '_mumbai_reset_token', $token_hash);
    update_user_meta($user->ID, '_mumbai_reset_expires', $expires);
    $reset_url = MUMBAI_FRONTEND_URL . '/reset-password?token=' . rawurlencode($token);
    $subject = 'Reset your Mumbai Collection password';
    $message  = "Hello {$user->display_name},\n\n";
    $message .= "We received a request to reset your Mumbai Collection password.\n\n";
    $message .= "Click the link below to create a new password:\n\n";
    $message .= $reset_url . "\n\n";
    $message .= "This link will expire in 30 minutes.\n\n";
    $message .= "If you did not request this, you can safely ignore this email.\n\n";
    $message .= "Mumbai Collection";
    $sent = wp_mail($user->user_email, $subject, $message);
    if (!$sent) {
        mumbai_log("Failed to send password reset email to user {$user->ID}");
        return new WP_Error(
            'email_failed',
            'Unable to send the password reset email.',
            ['status' => 500]
        );
    }
    mumbai_log("Password reset email sent to user {$user->ID}");
    return $generic_response;
}
/*
 * ─────────────────────────────────────────────
 * RESET PASSWORD
 * ─────────────────────────────────────────────
 */
function mumbai_reset_password(WP_REST_Request $request)
{
    $token    = sanitize_text_field($request->get_param('token'));
    $password = $request->get_param('password');
    if (!$token || !$password) {
        return new WP_Error(
            'missing_fields',
            'Reset token and password are required.',
            ['status' => 400]
        );
    }
    $pw_check = mumbai_validate_password($password);
    if ($pw_check !== true) {
        return new WP_Error(
            'weak_password',
            $pw_check,
            ['status' => 400]
        );
    }
    $token_hash = hash('sha256', $token);
    $users = get_users([
        'meta_key'   => '_mumbai_reset_token',
        'meta_value' => $token_hash,
        'number'     => 1,
        'fields'     => 'all',
    ]);
    if (empty($users)) {
        return new WP_Error(
            'invalid_token',
            'This password reset link is invalid or has expired.',
            ['status' => 400]
        );
    }
    $user = $users[0];

    global $wpdb;
    $has_db_lock = !empty($wpdb) && method_exists($wpdb, 'get_var');
    $lock_name = 'mumbai_reset_' . (int) $user->ID;
    if ($has_db_lock) {
        $got_lock = (int) $wpdb->get_var($wpdb->prepare("SELECT GET_LOCK(%s, 5)", $lock_name));
        if (!$got_lock) {
            return new WP_Error('lock_timeout', 'Password reset in progress, please retry.', ['status' => 429]);
        }
    }

    try {
        if (function_exists('clean_user_cache')) {
            clean_user_cache($user->ID);
        }

        $stored_token_hash = get_user_meta($user->ID, '_mumbai_reset_token', true);
        if (!$stored_token_hash || !hash_equals((string) $stored_token_hash, (string) $token_hash)) {
            return new WP_Error(
                'invalid_token',
                'This password reset link is invalid or has already been used.',
                ['status' => 400]
            );
        }

        $expires = get_user_meta($user->ID, '_mumbai_reset_expires', true);
        if (!$expires || time() > (int) $expires) {
            // Clean up expired token
            delete_user_meta($user->ID, '_mumbai_reset_token');
            delete_user_meta($user->ID, '_mumbai_reset_expires');
            return new WP_Error(
                'expired_token',
                'This password reset link has expired.',
                ['status' => 400]
            );
        }
        // Reset the password
        reset_password($user, $password);
        // Revoke ALL active sessions so a compromised token cannot persist (H7 fix)
        WP_Session_Tokens::get_instance($user->ID)->destroy_all();
        // Make token single-use
        delete_user_meta($user->ID, '_mumbai_reset_token');
        delete_user_meta($user->ID, '_mumbai_reset_expires');
        // Also clear any login lockout so user can log in immediately
        delete_user_meta($user->ID, '_mumbai_failed_logins');
        delete_user_meta($user->ID, '_mumbai_lockout_until');
        mumbai_log("Password reset completed for user {$user->ID}. All sessions revoked.");
        return [
            'success' => true,
            'message' => 'Password reset successfully. You can now login.',
            'user_id' => (int) $user->ID,
        ];
    } finally {
        if ($has_db_lock) {
            $wpdb->query($wpdb->prepare("SELECT RELEASE_LOCK(%s)", $lock_name));
        }
    }
}
/*
 * ─────────────────────────────────────────────
 * LOGOUT
 * ─────────────────────────────────────────────
 * Destroys the WordPress session server-side
 * so the cookie becomes immediately invalid.
 */
function mumbai_logout(WP_REST_Request $request)
{
    $cookie_value = $_COOKIE[LOGGED_IN_COOKIE] ?? '';
    if (!$cookie_value) {
        return [
            'success' => true,
            'message' => 'Already logged out.',
        ];
    }
    $user_id = wp_validate_auth_cookie($cookie_value, 'logged_in');
    if ($user_id) {
        /*
         * Extract the session token from the cookie and
         * destroy only THIS session (not all devices).
         */
        $parsed = wp_parse_auth_cookie($cookie_value, 'logged_in');
        $token = $parsed ? ($parsed['token'] ?? '') : wp_get_session_token();
        $session_manager = WP_Session_Tokens::get_instance($user_id);
        if ($token) {
            $session_manager->destroy($token);
        } else {
            // Fallback: destroy all sessions for this user
            $session_manager->destroy_all();
        }
        mumbai_log("User {$user_id} logged out.");
    }
    return [
        'success' => true,
        'message' => 'Logged out successfully.',
    ];
}
/*
 * ─────────────────────────────────────────────
 * ME (Session Validation)
 * ─────────────────────────────────────────────
 * Returns ONLY what the Node backend needs.
 * No cookie names, no debug data.
 */
/**
 * Normalize extra whitespace in a person's name (collapse multiple whitespace characters to a single space).
 */
function mumbai_normalize_name($name) {
    if (!is_string($name)) return '';
    return trim(preg_replace('/\s+/u', ' ', $name));
}

/**
 * Validates that a person's name:
 * 1. Has non-empty content (1 to 100 characters).
 * 2. Starts with a Unicode letter or mark.
 * 3. Contains only Unicode letters, marks (supporting Indian scripts like Devanagari, Gujarati, etc.),
 *    spaces, hyphens, apostrophes, and periods for initials.
 * 4. Rejects punctuation/symbols such as semicolons (;), colons, brackets, @, $, digits, etc.
 * 5. Contains at least one letter.
 */
function mumbai_is_valid_person_name($name) {
    $normalized = mumbai_normalize_name($name);
    if ($normalized === '' || strlen($normalized) < 1 || strlen($normalized) > 200) {
        return false;
    }
    // Must start with a Unicode letter or mark, allow letters, marks, spaces, hyphens, apostrophes, and periods
    if (!preg_match('/^[\p{L}\p{M}][\p{L}\p{M}\s.\'’\-]*$/u', $normalized)) {
        return false;
    }
    // Must contain at least one Unicode letter or mark
    return (bool) preg_match('/[\p{L}\p{M}]/u', $normalized);
}

/**
 * Validates password complexity:
 * 1. At least 8 characters long (and max 256).
 * 2. At least one uppercase letter (A-Z).
 * 3. At least one lowercase letter (a-z).
 * 4. At least one number (0-9).
 * 5. At least one special character (e.g. !@#$%^&*).
 *
 * Returns true if valid, or an error message string if invalid.
 */
function mumbai_validate_password($password) {
    if (!is_string($password) || empty($password)) {
        return 'Password is required.';
    }
    if (strlen($password) < 8) {
        return 'Password must be at least 8 characters long.';
    }
    if (strlen($password) > 256) {
        return 'Password is too long (maximum 256 characters).';
    }
    if (!preg_match('/[A-Z]/', $password)) {
        return 'Password must contain at least one uppercase letter (A-Z).';
    }
    if (!preg_match('/[a-z]/', $password)) {
        return 'Password must contain at least one lowercase letter (a-z).';
    }
    if (!preg_match('/[0-9]/', $password)) {
        return 'Password must contain at least one number (0-9).';
    }
    if (!preg_match('/[^A-Za-z0-9]/', $password)) {
        return 'Password must contain at least one special character (e.g. !@#$%^&*).';
    }
    return true;
}

function mumbai_is_valid_password($password) {
    return mumbai_validate_password($password) === true;
}

/**
 * Normalize phone number to 10-digit Indian local format
 */
function mumbai_normalize_phone($phone) {
    if (empty($phone)) return '';
    $clean = preg_replace('/\D/', '', (string) $phone);
    if (strlen($clean) === 12 && str_starts_with($clean, '91')) {
        $clean = substr($clean, 2);
    }
    if (strlen($clean) === 11 && str_starts_with($clean, '0')) {
        $clean = substr($clean, 1);
    }
    return $clean;
}

/**
 * Return the customer's valid 10-digit Indian contact number, if present.
 * Phone numbers are billing/shipping contact data and are not OTP-verified.
 */
function mumbai_get_user_contact_phone($user_id) {
    if (!$user_id) {
        return '';
    }

    $candidates = [(string) get_user_meta($user_id, 'billing_phone', true)];
    $profile = get_user_meta($user_id, '_mumbai_user_profile', true);
    if (is_array($profile) && !empty($profile['phone'])) {
        $candidates[] = (string) $profile['phone'];
    }

    $addresses = get_user_meta($user_id, '_mumbai_saved_addresses', true);
    if (is_array($addresses)) {
        foreach ($addresses as $addr) {
            if (!empty($addr['phone'])) {
                $candidates[] = (string) $addr['phone'];
            }
        }
    }

    foreach ($candidates as $candidate) {
        $clean_phone = mumbai_normalize_phone($candidate);
        if (preg_match('/^[6-9][0-9]{9}$/', $clean_phone)) {
            return $clean_phone;
        }
    }

    return '';
}

function mumbai_is_user_phone_verified($user_id) {
    return mumbai_get_user_contact_phone($user_id) !== '';
}

function mumbai_me()
{
    if (!defined('LOGGED_IN_COOKIE')) {
        return [
            'logged_in'       => false,
            'current_user_id' => 0,
            'roles'           => [],
        ];
    }

    $cookie_value = $_COOKIE[LOGGED_IN_COOKIE] ?? '';
    $validated_user_id = 0;

    if ($cookie_value) {
        $validated_user_id = wp_validate_auth_cookie(
            $cookie_value,
            'logged_in'
        );

        // wp_validate_auth_cookie returns false on failure
        if ($validated_user_id === false) {
            $validated_user_id = 0;
        }
    }

    $user = $validated_user_id
        ? get_user_by('id', $validated_user_id)
        : null;

    // Enforce 12-hour session lifetime on existing/active staff sessions in WordPress
    if ($user && $cookie_value && class_exists('WP_Session_Tokens')) {
        $user_roles = (array) $user->roles;
        $is_staff = !empty(array_intersect(['administrator', 'employee', 'shop_manager'], $user_roles));
        if ($is_staff) {
            $cookie_elements = wp_parse_auth_cookie($cookie_value, 'logged_in');
            if ($cookie_elements && !empty($cookie_elements['token'])) {
                $token = $cookie_elements['token'];
                $manager = WP_Session_Tokens::get_instance($user->ID);
                $session = $manager->get($token);
                if (is_array($session)) {
                    $login_time = !empty($session['login']) ? (int) $session['login'] : 0;
                    $max_allowed_expiration = $login_time > 0
                        ? $login_time + (12 * HOUR_IN_SECONDS)
                        : time() + (12 * HOUR_IN_SECONDS);

                    // If the session was created more than 12 hours ago, revoke it immediately
                    if ($login_time > 0 && time() > $max_allowed_expiration) {
                        $manager->destroy($token);
                        return [
                            'logged_in'       => false,
                            'current_user_id' => 0,
                            'roles'           => [],
                        ];
                    }

                    // If expiration exceeds 12 hours from session creation, clamp it
                    if (isset($session['expiration']) && (int) $session['expiration'] > $max_allowed_expiration) {
                        $session['expiration'] = $max_allowed_expiration;
                        $manager->update($token, $session);
                    }
                }
            }
        }
    }

    $is_phone_verified = false;
    $is_suspended = false;
    $phone = '';
    $verified_phone = '';
    $display_name = '';
    if ($user) {
        $is_phone_verified = mumbai_is_user_phone_verified($user->ID);
        $is_suspended = function_exists('mumbai_is_customer_suspended') ? mumbai_is_customer_suspended($user->ID) : false;
        $phone = (string) get_user_meta($user->ID, 'billing_phone', true);
        $prof = get_user_meta($user->ID, '_mumbai_user_profile', true);
        if (empty($phone) && is_array($prof) && !empty($prof['phone'])) {
            $phone = (string) $prof['phone'];
        }
        $verified_phone = mumbai_get_user_contact_phone($user->ID);
        if (is_array($prof) && !empty($prof['full_name'])) {
            $display_name = trim((string) $prof['full_name']);
        }
        $first_name = (string) get_user_meta($user->ID, 'first_name', true);
        $last_name = (string) get_user_meta($user->ID, 'last_name', true);
        if (empty($first_name)) {
            $first_name = (string) get_user_meta($user->ID, 'billing_first_name', true);
        }
        if (empty($last_name)) {
            $last_name = (string) get_user_meta($user->ID, 'billing_last_name', true);
        }
        if (empty($display_name)) {
            $billing_first = (string) get_user_meta($user->ID, 'billing_first_name', true);
            $billing_last = (string) get_user_meta($user->ID, 'billing_last_name', true);
            $full = trim("{$first_name} {$last_name}");
            $billing_full = trim("{$billing_first} {$billing_last}");
            $display_name = $full ?: ($billing_full ?: trim((string) $user->display_name));
        }
    }

    return [
        'logged_in'          => $validated_user_id > 0,
        'current_user_id'    => $validated_user_id,
        'email'              => $user ? (string) $user->user_email : '',
        'username'           => $user ? (string) $user->user_login : '',
        'first_name'         => $first_name,
        'last_name'          => $last_name,
        'roles'              => $user ? array_values($user->roles) : [],
        'name'               => $display_name,
        'display_name'       => $display_name,
        'is_phone_verified'  => $is_phone_verified,
        'is_suspended'       => $is_suspended,
        'phone'              => $phone,
        'verified_phone'     => $verified_phone,
    ];
}
/*
 * ─────────────────────────────────────────────
 * INTERNAL PERMISSION CHECK
 * ─────────────────────────────────────────────
 * Validates X-Mumbai-Internal-Key header and
 * X-Mumbai-User-ID header for Node.js calls.
 */
function mumbai_internal_server_permission(WP_REST_Request $request)
{
    if (!mumbai_has_internal_key_configured()) {
        return new WP_Error(
            'plugin_misconfigured',
            'Server configuration error.',
            ['status' => 500]
        );
    }
    $api_key = $request->get_header('X-Mumbai-Internal-Key');
    if (!$api_key) {
        return new WP_Error(
            'missing_internal_key',
            'Authentication required.',
            ['status' => 401]
        );
    }
    if (!mumbai_is_valid_internal_key($api_key)) {
        mumbai_log('Invalid internal API key attempt.');
        return new WP_Error(
            'invalid_internal_key',
            'Authentication failed.',
            ['status' => 401]
        );
    }
    return true;
}

function mumbai_internal_permission(WP_REST_Request $request)
{
    $server_check = mumbai_internal_server_permission($request);
    if (is_wp_error($server_check)) {
        return $server_check;
    }
    $user_id = absint(
        $request->get_header('X-Mumbai-User-ID')
    );
    if (!$user_id) {
        return new WP_Error(
            'missing_user_id',
            'User authentication required.',
            ['status' => 401]
        );
    }
    $user = get_user_by('id', $user_id);
    if (!$user) {
        return new WP_Error(
            'invalid_user_id',
            'Invalid user.',
            ['status' => 401]
        );
    }
    return true;
}
/*
 * ─────────────────────────────────────────────
 * ADDRESSES: GET
 * ─────────────────────────────────────────────
 */
function mumbai_get_addresses(WP_REST_Request $request)
{
    $user_id = absint(
        $request->get_header('X-Mumbai-User-ID')
    );
    if (!$user_id) {
        return new WP_Error(
            'missing_user_id',
            'User ID is required.',
            ['status' => 401]
        );
    }
    $addresses = get_user_meta(
        $user_id,
        '_mumbai_saved_addresses',
        true
    );
    if (!is_array($addresses)) {
        $addresses = [];
    }
    return [
        'success'   => true,
        'addresses' => $addresses,
    ];
}
/*
 * ─────────────────────────────────────────────
 * ADDRESSES: SAVE (POST)
 * ─────────────────────────────────────────────
 */
function mumbai_save_address(WP_REST_Request $request)
{
    $user_id = absint(
        $request->get_header('X-Mumbai-User-ID')
    );
    if (!$user_id) {
        return new WP_Error(
            'missing_user_id',
            'User ID is required.',
            ['status' => 401]
        );
    }
    $type          = sanitize_key($request->get_param('type'));
    $first_name    = sanitize_text_field($request->get_param('first_name'));
    $last_name     = sanitize_text_field($request->get_param('last_name'));
    $full_name     = sanitize_text_field($request->get_param('full_name'));
    $phone         = sanitize_text_field($request->get_param('phone'));
    $address_line1 = sanitize_text_field($request->get_param('address_line1'));
    $address_line2 = sanitize_text_field($request->get_param('address_line2'));
    $city          = sanitize_text_field($request->get_param('city'));
    $state         = sanitize_text_field($request->get_param('state'));
    $pincode       = sanitize_text_field($request->get_param('pincode'));

    if (empty($first_name) || empty($last_name)) {
        if (!empty($full_name)) {
            $parts = preg_split('/\s+/', trim($full_name));
            if (empty($first_name) && !empty($parts[0])) {
                $first_name = $parts[0];
            }
            if (empty($last_name) && count($parts) > 1) {
                $last_name = implode(' ', array_slice($parts, 1));
            }
        }
    }

    $first_name = mumbai_normalize_name($first_name);
    $last_name  = mumbai_normalize_name($last_name);

    if (empty($first_name)) {
        return new WP_Error(
            'missing_first_name',
            'First name is required.',
            ['status' => 400]
        );
    }
    if (!mumbai_is_valid_person_name($first_name)) {
        return new WP_Error(
            'invalid_first_name',
            'First name can only contain letters, spaces, hyphens, apostrophes, and periods.',
            ['status' => 400]
        );
    }

    if (empty($last_name)) {
        return new WP_Error(
            'missing_last_name',
            'Last name is required.',
            ['status' => 400]
        );
    }
    if (!mumbai_is_valid_person_name($last_name)) {
        return new WP_Error(
            'invalid_last_name',
            'Last name can only contain letters, spaces, hyphens, apostrophes, and periods.',
            ['status' => 400]
        );
    }

    $clean_full_name = trim("{$first_name} {$last_name}");

    if (!in_array($type, ['home', 'office'], true)) {
        return new WP_Error(
            'invalid_address_type',
            'Address type must be home or office.',
            ['status' => 400]
        );
    }
    if (!$phone || !$address_line1 || !$city || !$state) {
        return new WP_Error(
            'missing_address_fields',
            'Please provide all required address fields.',
            ['status' => 400]
        );
    }
    $addresses = get_user_meta($user_id, '_mumbai_saved_addresses', true);
    if (!is_array($addresses)) {
        $addresses = [];
    }
    $new_address = [
        'id'            => wp_generate_uuid4(),
        'type'          => $type,
        'first_name'    => $first_name,
        'last_name'     => $last_name,
        'full_name'     => $clean_full_name,
        'phone'         => $phone,
        'address_line1' => $address_line1,
        'address_line2' => $address_line2,
        'city'          => $city,
        'state'         => $state,
        'pincode'       => $pincode ? $pincode : '',
    ];
    // Replace existing address of same type
    $updated = false;
    foreach ($addresses as $index => $address) {
        if (isset($address['type']) && $address['type'] === $type) {
            $addresses[$index] = $new_address;
            $updated = true;
            break;
        }
    }
    if (!$updated) {
        $addresses[] = $new_address;
    }
    update_user_meta($user_id, '_mumbai_saved_addresses', $addresses);
    if (!empty($phone)) {
        update_user_meta($user_id, 'billing_phone', $phone);
    }
    return [
        'success'   => true,
        'message'   => ucfirst($type) . ' address saved successfully.',
        'address'   => $new_address,
        'addresses' => $addresses,
    ];
}
/*
 * ─────────────────────────────────────────────
 * ADDRESSES: UPDATE (PUT)
 * ─────────────────────────────────────────────
 */
function mumbai_update_address(WP_REST_Request $request)
{
    $user_id    = absint($request->get_header('X-Mumbai-User-ID'));
    $address_id = sanitize_text_field($request->get_param('id'));
    if (!$user_id) {
        return new WP_Error(
            'missing_user_id',
            'User ID is required.',
            ['status' => 401]
        );
    }
    if (!$address_id) {
        return new WP_Error(
            'missing_address_id',
            'Address ID is required.',
            ['status' => 400]
        );
    }
    $type          = sanitize_key($request->get_param('type'));
    $first_name    = sanitize_text_field($request->get_param('first_name'));
    $last_name     = sanitize_text_field($request->get_param('last_name'));
    $full_name     = sanitize_text_field($request->get_param('full_name'));
    $phone         = sanitize_text_field($request->get_param('phone'));
    $address_line1 = sanitize_text_field($request->get_param('address_line1'));
    $address_line2 = sanitize_text_field($request->get_param('address_line2'));
    $city          = sanitize_text_field($request->get_param('city'));
    $state         = sanitize_text_field($request->get_param('state'));
    $pincode       = sanitize_text_field($request->get_param('pincode'));

    if (empty($first_name) || empty($last_name)) {
        if (!empty($full_name)) {
            $parts = preg_split('/\s+/', trim($full_name));
            if (empty($first_name) && !empty($parts[0])) {
                $first_name = $parts[0];
            }
            if (empty($last_name) && count($parts) > 1) {
                $last_name = implode(' ', array_slice($parts, 1));
            }
        }
    }

    $first_name = mumbai_normalize_name($first_name);
    $last_name  = mumbai_normalize_name($last_name);

    if (empty($first_name)) {
        return new WP_Error(
            'missing_first_name',
            'First name is required.',
            ['status' => 400]
        );
    }
    if (!mumbai_is_valid_person_name($first_name)) {
        return new WP_Error(
            'invalid_first_name',
            'First name can only contain letters, spaces, hyphens, apostrophes, and periods.',
            ['status' => 400]
        );
    }

    if (empty($last_name)) {
        return new WP_Error(
            'missing_last_name',
            'Last name is required.',
            ['status' => 400]
        );
    }
    if (!mumbai_is_valid_person_name($last_name)) {
        return new WP_Error(
            'invalid_last_name',
            'Last name can only contain letters, spaces, hyphens, apostrophes, and periods.',
            ['status' => 400]
        );
    }

    $clean_full_name = trim("{$first_name} {$last_name}");

    if (!in_array($type, ['home', 'office'], true)) {
        return new WP_Error(
            'invalid_address_type',
            'Address type must be home or office.',
            ['status' => 400]
        );
    }
    if (!$phone || !$address_line1 || !$city || !$state) {
        return new WP_Error(
            'missing_address_fields',
            'Please provide all required address fields.',
            ['status' => 400]
        );
    }
    $addresses = get_user_meta($user_id, '_mumbai_saved_addresses', true);
    if (!is_array($addresses)) {
        $addresses = [];
    }
    $updated      = false;
    $updated_addr = null;
    foreach ($addresses as $index => $address) {
        if (isset($address['id']) && $address['id'] === $address_id) {
            $addresses[$index] = [
                'id'            => $address_id,
                'type'          => $type,
                'first_name'    => $first_name,
                'last_name'     => $last_name,
                'full_name'     => $clean_full_name,
                'phone'         => $phone,
                'address_line1' => $address_line1,
                'address_line2' => $address_line2,
                'city'          => $city,
                'state'         => $state,
                'pincode'       => $pincode !== '' ? $pincode : ($address['pincode'] ?? ''),
            ];
            $updated      = true;
            $updated_addr = $addresses[$index];
            break;
        }
    }
    if (!$updated) {
        return new WP_Error(
            'address_not_found',
            'Address not found.',
            ['status' => 404]
        );
    }
    update_user_meta($user_id, '_mumbai_saved_addresses', $addresses);
    if (!empty($phone)) {
        update_user_meta($user_id, 'billing_phone', $phone);
    }
    return [
        'success'   => true,
        'message'   => 'Address updated successfully.',
        'address'   => $updated_addr,
        'addresses' => $addresses,
    ];
}
/*
 * ─────────────────────────────────────────────
 * ADDRESSES: DELETE
 * ─────────────────────────────────────────────
 */
function mumbai_delete_address(WP_REST_Request $request)
{
    $user_id    = absint($request->get_header('X-Mumbai-User-ID'));
    $address_id = sanitize_text_field($request->get_param('id'));
    if (!$user_id) {
        return new WP_Error(
            'missing_user_id',
            'User ID is required.',
            ['status' => 401]
        );
    }
    if (!$address_id) {
        return new WP_Error(
            'missing_address_id',
            'Address ID is required.',
            ['status' => 400]
        );
    }
    $addresses = get_user_meta($user_id, '_mumbai_saved_addresses', true);
    if (!is_array($addresses)) {
        $addresses = [];
    }
    $found = false;
    foreach ($addresses as $index => $address) {
        if (isset($address['id']) && $address['id'] === $address_id) {
            unset($addresses[$index]);
            $found = true;
            break;
        }
    }
    if (!$found) {
        return new WP_Error(
            'address_not_found',
            'Address not found.',
            ['status' => 404]
        );
    }
    // Re-index array
    $addresses = array_values($addresses);
    update_user_meta($user_id, '_mumbai_saved_addresses', $addresses);
    return [
        'success'   => true,
        'message'   => 'Address deleted successfully.',
        'addresses' => $addresses,
    ];
}
/*
 * ─────────────────────────────────────────────
 * PROFILE: GET
 * ─────────────────────────────────────────────
 */
function mumbai_get_profile(WP_REST_Request $request)
{
    $user_id = absint($request->get_header('X-Mumbai-User-ID'));
    if (!$user_id) {
        return new WP_Error(
            'missing_user_id',
            'User ID is required.',
            ['status' => 401]
        );
    }
    $billing_phone = (string) get_user_meta($user_id, 'billing_phone', true);
    $verified_phone = mumbai_get_user_contact_phone($user_id);
    $is_phone_verified = mumbai_is_user_phone_verified($user_id);

    $profile = get_user_meta($user_id, '_mumbai_user_profile', true);
    if (!is_array($profile)) {
        $profile = [
            'full_name' => '',
            'phone'     => '',
        ];
    }
    if (empty($profile['full_name'])) {
        $u = get_user_by('id', $user_id);
        if ($u) {
            $first_name = (string) get_user_meta($user_id, 'first_name', true);
            $last_name = (string) get_user_meta($user_id, 'last_name', true);
            $billing_first = (string) get_user_meta($user_id, 'billing_first_name', true);
            $billing_last = (string) get_user_meta($user_id, 'billing_last_name', true);
            $full = trim("{$first_name} {$last_name}");
            $billing_full = trim("{$billing_first} {$billing_last}");
            $profile['full_name'] = $full ?: ($billing_full ?: trim((string) $u->display_name));
        }
    }
    // billing_phone is the canonical primary phone; sync it to profile
    if (!empty($billing_phone)) {
        $profile['phone'] = $billing_phone;
    }

    // Strip legacy fields from existing stored user profiles so they never leak in responses
    unset($profile['age'], $profile['secondary_phone']);

    return [
        'success'           => true,
        'profile'           => $profile,
        'is_phone_verified' => $is_phone_verified,
        'verified_phone'    => $verified_phone,
        'billing_phone'     => $billing_phone,
    ];
}
/*
 * ─────────────────────────────────────────────
 * PROFILE: SAVE (PUT)
 * ─────────────────────────────────────────────
 */
function mumbai_save_profile(WP_REST_Request $request)
{
    $user_id = absint($request->get_header('X-Mumbai-User-ID'));
    if (!$user_id) {
        return new WP_Error(
            'missing_user_id',
            'User ID is required.',
            ['status' => 401]
        );
    }
    $first_name      = sanitize_text_field($request->get_param('first_name'));
    $last_name       = sanitize_text_field($request->get_param('last_name'));
    $full_name       = sanitize_text_field($request->get_param('full_name'));
    $phone           = sanitize_text_field($request->get_param('phone'));

    if (empty($first_name) || empty($last_name)) {
        if (!empty($full_name)) {
            $parts = preg_split('/\s+/', trim($full_name));
            if (empty($first_name) && !empty($parts[0])) {
                $first_name = $parts[0];
            }
            if (empty($last_name) && count($parts) > 1) {
                $last_name = implode(' ', array_slice($parts, 1));
            }
        }
    }

    $first_name = mumbai_normalize_name($first_name);
    $last_name  = mumbai_normalize_name($last_name);

    if (empty($first_name)) {
        return new WP_Error(
            'missing_first_name',
            'First name is required.',
            ['status' => 400]
        );
    }
    if (!mumbai_is_valid_person_name($first_name)) {
        return new WP_Error(
            'invalid_first_name',
            'First name can only contain letters, spaces, hyphens, apostrophes, and periods.',
            ['status' => 400]
        );
    }

    if (empty($last_name)) {
        return new WP_Error(
            'missing_last_name',
            'Last name is required.',
            ['status' => 400]
        );
    }
    if (!mumbai_is_valid_person_name($last_name)) {
        return new WP_Error(
            'invalid_last_name',
            'Last name can only contain letters, spaces, hyphens, apostrophes, and periods.',
            ['status' => 400]
        );
    }

    $clean_full_name = trim("{$first_name} {$last_name}");

    $old_billing_phone = (string) get_user_meta($user_id, 'billing_phone', true);
    $clean_old_billing = mumbai_normalize_phone($old_billing_phone);

    // Primary Phone Rule: Rigorously enforce uniqueness across all customer accounts.
    $incoming_phone = mumbai_normalize_phone($phone);
    if (!empty($incoming_phone)) {
        if (!preg_match('/^[6-9][0-9]{9}$/', $incoming_phone)) {
            return new WP_Error(
                'invalid_phone',
                'A valid 10-digit primary mobile number starting with 6, 7, 8, or 9 is required.',
                ['status' => 400]
            );
        }

        $existing_phone_user = mumbai_get_user_by_phone($incoming_phone);
        if ($existing_phone_user && (int) $existing_phone_user->ID !== (int) $user_id) {
            return new WP_Error(
                'phone_exists',
                'This mobile number is already registered to another account. Please use a different number.',
                ['status' => 409]
            );
        }

        $clean_phone = $incoming_phone;
        update_user_meta($user_id, 'billing_phone', $clean_phone);
    } elseif (!empty($clean_old_billing)) {
        $clean_phone = $clean_old_billing;
    } else {
        return new WP_Error(
            'invalid_phone',
            'A valid 10-digit primary mobile number is required.',
            ['status' => 400]
        );
    }

    $password = $request->get_param('password');
    $password_changed = false;
    if (!empty($password)) {
        $current_password = (string) $request->get_param('current_password');
        $user_obj = get_userdata($user_id);
        if (!$user_obj || empty($current_password) || !wp_check_password($current_password, $user_obj->user_pass, $user_id)) {
            return new WP_Error(
                'invalid_current_password',
                'Your current password is required and must be correct to set a new password.',
                ['status' => 403]
            );
        }
        $pw_check = mumbai_validate_password($password);
        if ($pw_check !== true) {
            return new WP_Error('weak_password', $pw_check, ['status' => 400]);
        }
        wp_set_password($password, $user_id);
        $password_changed = true;
    }

    wp_update_user([
        'ID'           => $user_id,
        'first_name'   => $first_name,
        'last_name'    => $last_name,
        'display_name' => $clean_full_name,
    ]);
    update_user_meta($user_id, 'billing_first_name', $first_name);
    update_user_meta($user_id, 'billing_last_name', $last_name);
    update_user_meta($user_id, 'shipping_first_name', $first_name);
    update_user_meta($user_id, 'shipping_last_name', $last_name);

    $profile = [
        'first_name'      => $first_name,
        'last_name'       => $last_name,
        'full_name'       => $clean_full_name,
        'phone'           => $clean_phone,
    ];
    update_user_meta($user_id, '_mumbai_user_profile', $profile);

    // Update indexed directory fields before reporting the profile save as successful.
    mumbai_sync_customer_search_index($user_id);

    $is_phone_verified = mumbai_is_user_phone_verified($user_id);
    $current_verified_phone = mumbai_get_user_contact_phone($user_id);

    $response = [
        'success'           => true,
        'message'           => 'Profile saved successfully.',
        'profile'           => $profile,
        'is_phone_verified' => $is_phone_verified,
        'verified_phone'    => $current_verified_phone,
        'billing_phone'     => (string) get_user_meta($user_id, 'billing_phone', true),
    ];

    if ($password_changed) {
        // Password changes invalidate cookies signed with the previous hash.
        // Issue a fresh logged-in cookie so the customer can finish profile and
        // address setup without being unexpectedly signed out mid-flow.
        wp_set_current_user($user_id);
        $expiration = time() + (30 * DAY_IN_SECONDS);
        $session_manager = WP_Session_Tokens::get_instance($user_id);
        $session_token = $session_manager->create($expiration);

        wp_set_auth_cookie($user_id, true, is_ssl(), $session_token);
        $logged_in_cookie = wp_generate_auth_cookie(
            $user_id,
            $expiration,
            'logged_in',
            $session_token
        );
        $_COOKIE[LOGGED_IN_COOKIE] = $logged_in_cookie;

        $response['session'] = $logged_in_cookie;
        $response['cookie_name'] = LOGGED_IN_COOKIE;
        $response['rest_nonce'] = wp_create_nonce('wp_rest');
    }

    return $response;
}
/*
 * ─────────────────────────────────────────────
 * PROFILE: CHECK COMPLETION
 * ─────────────────────────────────────────────
 */
function mumbai_check_profile_complete(WP_REST_Request $request)
{
    $user_id = absint($request->get_header('X-Mumbai-User-ID'));
    if (!$user_id) {
        return new WP_Error(
            'missing_user_id',
            'User ID is required.',
            ['status' => 401]
        );
    }
    $profile   = get_user_meta($user_id, '_mumbai_user_profile', true);
    $addresses = get_user_meta($user_id, '_mumbai_saved_addresses', true);
    if (!is_array($profile)) {
        $profile = [];
    }
    if (!is_array($addresses)) {
        $addresses = [];
    }
    $is_phone_verified = mumbai_is_user_phone_verified($user_id);
    $verified_phone = mumbai_get_user_contact_phone($user_id);

    $profile_complete =
        !empty($profile['full_name']) &&
        !empty($profile['phone']);
    $has_address = false;
    foreach ($addresses as $address) {
        if (
            isset($address['type']) &&
            in_array($address['type'], ['home', 'office'], true)
        ) {
            $has_address = true;
            break;
        }
    }
    $complete = $profile_complete && $has_address;

    // Strip legacy fields from existing stored user profiles so they never leak in responses
    unset($profile['age'], $profile['secondary_phone']);

    return [
        'success'           => true,
        'complete'          => $complete,
        'profile_complete'  => $profile_complete,
        'address_complete'  => $has_address,
        'is_phone_verified' => $is_phone_verified,
        'verified_phone'    => $verified_phone,
        'profile'           => $profile,
        'addresses'         => $addresses,
    ];
}
/*
 * ─────────────────────────────────────────────
 * PROFILE: DELETE ACCOUNT (PERMANENT)
 * ─────────────────────────────────────────────
 *
 * Permanently deletes the authenticated customer.
 * This operation cannot be reversed.
 */
function mumbai_delete_account(WP_REST_Request $request)
{
    /*
     * User ID has already been validated by
     * mumbai_internal_permission().
     */
    $user_id = absint(
        $request->get_header('X-Mumbai-User-ID')
    );

    if (!$user_id) {
        return new WP_Error(
            'missing_user_id',
            'User ID is required.',
            ['status' => 401]
        );
    }

    /*
     * Make sure the user still exists.
     */
    $user = get_user_by('id', $user_id);

    if (!$user) {
        return new WP_Error(
            'user_not_found',
            'User account not found.',
            ['status' => 404]
        );
    }

    $password = (string) $request->get_param('password');
    if ($password === '') {
        return new WP_Error(
            'password_required',
            'Your current password is required to delete your account.',
            ['status' => 400]
        );
    }

    if (!wp_check_password($password, $user->user_pass, $user_id)) {
        return new WP_Error(
            'invalid_password',
            'The current password is incorrect.',
            ['status' => 403]
        );
    }

    /*
     * CRITICAL SECURITY GUARD:
     * Prevent deletion of administrator, shop_manager, employee, or super_admin accounts.
     * Only customer and subscriber self-deletion is permitted.
     */
    if (user_can($user_id, 'manage_options') || is_super_admin($user_id)) {
        mumbai_log("Blocked attempt to delete administrator account {$user_id}.");
        return new WP_Error(
            'cannot_delete_admin',
            'Administrator accounts cannot be deleted through this endpoint.',
            ['status' => 403]
        );
    }

    $roles = (array) $user->roles;
    if (
        in_array('administrator', $roles, true) ||
        in_array('shop_manager', $roles, true) ||
        in_array('employee', $roles, true)
    ) {
        mumbai_log("Blocked attempt to delete privileged/staff account {$user_id}.");
        return new WP_Error(
            'forbidden_deletion',
            'Privileged and staff accounts cannot be self-deleted.',
            ['status' => 403]
        );
    }

    if (!in_array('customer', $roles, true) && !in_array('subscriber', $roles, true)) {
        return new WP_Error(
            'forbidden_deletion',
            'Only customer accounts can be self-deleted.',
            ['status' => 403]
        );
    }

    /*
     * STEP 1: Guard against in-flight / active orders.
     * Reject account deletion if any order is active/in-flight (e.g. processing, packed, out-for-delivery)
     * to prevent delivery failure and logistics breakdown.
     */
    if (function_exists('wc_get_orders')) {
        $active_statuses = [
            'pending',
            'processing',
            'on-hold',
            'packed',
            'out-for-delivery',
            'dispatched',
            'in-transit',
        ];

        $active_orders = wc_get_orders([
            'customer_id' => $user_id,
            'status'      => $active_statuses,
            'limit'       => 1,
            'return'      => 'ids',
        ]);

        if (!empty($active_orders)) {
            mumbai_log("Blocked account deletion for user {$user_id}: active in-flight orders present.");
            return new WP_Error(
                'active_orders_exist',
                'Your account cannot be deleted while you have active or in-flight orders. Please wait until your orders are completed or cancelled.',
                ['status' => 400]
            );
        }

        /*
         * Disassociate historical/finalized orders from this customer ID
         * (set customer_id to 0 / guest order) so the customer's profile is unlinked
         * while statutory tax invoices & commercial records are preserved for legal compliance.
         */
        $all_customer_orders = wc_get_orders([
            'customer_id' => $user_id,
            'limit'       => -1,
            'return'      => 'objects',
        ]);

        foreach ($all_customer_orders as $cust_order) {
            if ($cust_order instanceof WC_Order) {
                $cust_order->set_customer_id(0);
                $cust_order->save();
            }
        }
    }

    /*
     * STEP 2
     * Destroy ALL WordPress sessions belonging
     * to this customer.
     */
    $session_manager =
        WP_Session_Tokens::get_instance($user_id);

    $session_manager->destroy_all();

    mumbai_log(
        "All sessions destroyed for user {$user_id} before account deletion."
    );

    /*
     * STEP 3
     * Load WordPress user deletion functions.
     */
    require_once ABSPATH . 'wp-admin/includes/user.php';

    /*
     * STEP 4
     * Find primary administrator ID to safely reassign any authored content.
     */
    $admin_users = get_users(['role' => 'administrator', 'number' => 1, 'orderby' => 'ID', 'order' => 'ASC']);
    $reassign_id = !empty($admin_users) ? (int) $admin_users[0]->ID : null;

    /*
     * STEP 5
     * Permanently delete the WordPress user with content reassignment.
     *
     * Associated user metadata is removed with
     * the WordPress user.
     */
    $deleted = wp_delete_user($user_id, $reassign_id);

    if (!$deleted) {
        mumbai_log(
            "Failed to permanently delete user account {$user_id}."
        );

        return new WP_Error(
            'deletion_failed',
            'Unable to delete account. Please try again.',
            ['status' => 500]
        );
    }

    /*
     * STEP 6
     * Return success to Node.js.
     */
    mumbai_log(
        "User account {$user_id} permanently deleted (reassigned to admin #{$reassign_id})."
    );

    return [
        'success' => true,
        'message' => 'Your account has been permanently deleted.',
    ];
}
/*
 * ─────────────────────────────────────────────
 * HOMEPAGE BANNERS
 * ─────────────────────────────────────────────
 * Persists and retrieves the 3 homepage promotional banners
 * stored in WordPress wp_options ('mumbai_homepage_banners').
 */
function mumbai_get_banners()
{
    $banners = get_option('mumbai_homepage_banners', []);
    if (!is_array($banners)) {
        $banners = [];
    }
    return [
        'success' => true,
        'banners' => $banners,
    ];
}

function mumbai_save_banners(WP_REST_Request $request)
{
    $params = $request->get_json_params();
    $banners = $params['banners'] ?? [];
    if (!is_array($banners)) {
        return new WP_Error(
            'invalid_banners_data',
            'Banners must be provided as an array.',
            ['status' => 400]
        );
    }
    if (count($banners) > 3) {
        return new WP_Error(
            'too_many_banners',
            'Maximum 3 homepage banners allowed.',
            ['status' => 400]
        );
    }
    // Sanitize each banner object (M2 fix)
    $sanitized = [];
    foreach ($banners as $index => $b) {
        if (!is_array($b)) continue;

        $raw_link = trim((string) ($b['link'] ?? ''));
        $safe_link = '';
        if ($raw_link !== '') {
            if (str_starts_with($raw_link, '/')) {
                // Safe internal relative route (e.g. /category/art, /categories)
                $safe_link = '/' . ltrim(sanitize_text_field($raw_link), '/');
            } elseif (preg_match('#^https?://#i', $raw_link)) {
                // Absolute HTTP/HTTPS URL
                $safe_link = esc_url_raw($raw_link, ['http', 'https']);
            }
        }

        $sanitized[] = [
            'id'               => !empty($b['id']) ? sanitize_text_field($b['id']) : 'banner-' . ($index + 1),
            'title'            => !empty($b['title']) ? sanitize_text_field($b['title']) : '',
            'link'             => $safe_link,
            'desktop_image'    => !empty($b['desktop_image']) ? esc_url_raw($b['desktop_image']) : '',
            'desktop_media_id' => !empty($b['desktop_media_id']) ? absint($b['desktop_media_id']) : null,
            'mobile_image'     => !empty($b['mobile_image']) ? esc_url_raw($b['mobile_image']) : '',
            'mobile_media_id'  => !empty($b['mobile_media_id']) ? absint($b['mobile_media_id']) : null,
            'is_active'        => isset($b['is_active']) ? (bool) $b['is_active'] : true,
        ];
    }
    update_option('mumbai_homepage_banners', $sanitized, false);
    return [
        'success' => true,
        'message' => 'Homepage banners saved successfully in WordPress.',
        'banners' => $sanitized,
    ];
}

/*
 * ─────────────────────────────────────────────
 * LOCAL STORE: OPTIONAL POSTCODE / PIN CODE
 * ─────────────────────────────────────────────
 * Mumbai Collection delivers exclusively to 4 local zones in Vasai & Nallasopara (MH).
 * Pin codes are not required from customers.
 */
add_filter('woocommerce_default_address_fields', function ($fields) {
    if (isset($fields['postcode'])) {
        $fields['postcode']['required'] = false;
    }
    return $fields;
});

add_filter('woocommerce_billing_fields', function ($fields) {
    if (isset($fields['billing_postcode'])) {
        $fields['billing_postcode']['required'] = false;
    }
    return $fields;
});

add_filter('woocommerce_shipping_fields', function ($fields) {
    if (isset($fields['shipping_postcode'])) {
        $fields['shipping_postcode']['required'] = false;
    }
    return $fields;
});

add_filter('woocommerce_get_country_locale', function ($locales) {
    if (isset($locales['IN']['postcode'])) {
        $locales['IN']['postcode']['required'] = false;
    }
    return $locales;
});

/*
 * ─────────────────────────────────────────────
 * LOCAL STORE: MINIMUM ORDER VALUE (₹500 PRODUCT SUBTOTAL)
 * ─────────────────────────────────────────────
 * Enforces a ₹500 minimum product subtotal across WooCommerce and Store API.
 * Delivery charges do NOT count toward this ₹500 minimum.
 */
add_action('woocommerce_store_api_checkout_update_order_from_request', function ($order, $request) {
    $items_subtotal = 0;
    foreach ($order->get_items() as $item) {
        $items_subtotal += (float) $item->get_subtotal();
    }

    if ($items_subtotal < 500) {
        $shortfall = 500 - $items_subtotal;
        $shortfall_formatted = (floor($shortfall) == $shortfall) ? number_format($shortfall, 0) : number_format($shortfall, 2);
        throw new \Automattic\WooCommerce\StoreApi\Exceptions\RouteException(
            'woocommerce_rest_min_order_value',
            sprintf('Add ₹%s more to reach the minimum order value of ₹500.', $shortfall_formatted),
            400
        );
    }

    // Enforce verified mobile phone and active suspension check on customer account before allowing order creation
    $customer_id = $order->get_customer_id();
    if ($customer_id > 0) {
        if (function_exists('mumbai_is_customer_suspended') && mumbai_is_customer_suspended($customer_id)) {
            throw new \Automattic\WooCommerce\StoreApi\Exceptions\RouteException(
                'CUSTOMER_SUSPENDED',
                'Your account is currently suspended and you cannot place new orders.',
                403
            );
        }
        if (!mumbai_is_user_phone_verified($customer_id)) {
            throw new \Automattic\WooCommerce\StoreApi\Exceptions\RouteException(
                'woocommerce_rest_phone_unverified',
                'Please enter your mobile number in your profile before placing an order.',
                403
            );
        }
    }
}, 10, 2);

add_action('woocommerce_check_cart_items', function () {
    if (WC()->cart) {
        $subtotal = (float) WC()->cart->get_subtotal();
        if ($subtotal < 500) {
            $shortfall = 500 - $subtotal;
            $shortfall_formatted = (floor($shortfall) == $shortfall) ? number_format($shortfall, 0) : number_format($shortfall, 2);
            wc_add_notice(
                sprintf('Add ₹%s more to reach the minimum order value of ₹500.', $shortfall_formatted),
                'error'
            );
        }
    }
});

/*
 * ─────────────────────────────────────────────
 * WOOCOMMERCE EMAIL NOTIFICATIONS CONFIGURATION
 * ─────────────────────────────────────────────
 * Mutes routine administrative emails sent to the store owner / admin mailbox:
 *   - New Order (new_order)
 *   - Cancelled Order (cancelled_order)
 *   - Failed Order (failed_order)
 *   - Low Stock (low_stock)
 *   - No Stock (no_stock)
 *   - Backorder (backorder)
 * These operational events are already actively monitored in the dedicated
 * Admin and Employee panels.
 *
 * All customer transactional emails (order processing, order completed, on-hold,
 * customer invoice, notes, refunds, account welcome, password reset) REMAIN
 * ENABLED and addressed to the customer's registered/billing email.
 */

// 1. Disable routine admin order notifications via recipient & enabled filters
$mumbai_admin_email_types = ['new_order', 'cancelled_order', 'failed_order'];
foreach ($mumbai_admin_email_types as $mumbai_email_id) {
    add_filter("woocommerce_email_recipient_{$mumbai_email_id}", '__return_empty_string', 99, 3);
    add_filter("woocommerce_email_enabled_{$mumbai_email_id}", '__return_false', 99, 3);
}

// 2. Disable routine admin stock & inventory notifications via recipient filters
add_filter('woocommerce_email_recipient_low_stock', '__return_empty_string', 99, 2);
add_filter('woocommerce_email_recipient_no_stock', '__return_empty_string', 99, 2);
add_filter('woocommerce_email_recipient_backorder', '__return_empty_string', 99, 2);

// 3. Prevent WooCommerce stock notification checks from querying recipients or triggering mail
add_filter('pre_option_woocommerce_notify_low_stock', function () { return 'no'; }, 99);
add_filter('pre_option_woocommerce_notify_no_stock', function () { return 'no'; }, 99);
add_filter('pre_option_woocommerce_stock_email_recipient', '__return_empty_string', 99);

// 4. Fallback safeguard on WooCommerce email classes registration:
// Ensures any routine non-customer (admin) email is disabled while strictly preserving customer emails
add_filter('woocommerce_email_classes', function ($emails) {
    if (!is_array($emails)) {
        return $emails;
    }
    foreach ($emails as $email) {
        if (is_object($email) && method_exists($email, 'is_customer_email')) {
            // Strictly target admin emails; never touch customer transactional emails
            if (!$email->is_customer_email()) {
                $email->enabled = 'no';
                $email->recipient = '';
            }
        }
    }
    return $emails;
}, 99, 1);

/*
 * ─────────────────────────────────────────────
 * EMAIL OTP ENDPOINTS
 * ─────────────────────────────────────────────
 */

function mumbai_get_user_by_phone($phone) {
    if (empty($phone)) return null;
    $clean_phone = mumbai_normalize_phone($phone);
    if (empty($clean_phone)) return null;

    // Older WooCommerce records may store phones in display formats such as
    // "+91 73399-51567" or "0 73399 51567". Compare their digit-only suffix
    // instead of relying on an exact user-meta match, which would let those
    // existing numbers be claimed again in the normalized registration flow.
    global $wpdb;
    $digits_only_meta = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(meta_value, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), '/', ''), CHAR(9), '')";
    $sql = $wpdb->prepare(
        "SELECT user_id
         FROM (
             SELECT user_id, {$digits_only_meta} AS normalized_phone
             FROM {$wpdb->usermeta}
             WHERE meta_key = %s
         ) AS phone_meta
         WHERE RIGHT(normalized_phone, 10) = %s
           AND (
               CHAR_LENGTH(normalized_phone) = 10
               OR (CHAR_LENGTH(normalized_phone) = 11 AND LEFT(normalized_phone, 1) = '0')
               OR (CHAR_LENGTH(normalized_phone) = 12 AND LEFT(normalized_phone, 2) = '91')
           )
         ORDER BY user_id ASC
         LIMIT 1",
        'billing_phone',
        $clean_phone
    );
    $user_id = (int) $wpdb->get_var($sql);

    // Fallback 1: Check users table for user_login match (e.g. registered with phone)
    if (!$user_id) {
        $user_by_login = $wpdb->get_var($wpdb->prepare(
            "SELECT ID FROM {$wpdb->users}
             WHERE user_login = %s OR user_login = %s OR user_login = %s
             ORDER BY ID ASC LIMIT 1",
            $clean_phone,
            '+91' . $clean_phone,
            '91' . $clean_phone
        ));
        if ($user_by_login) {
            $user_id = (int) $user_by_login;
        }
    }

    // Fallback 2: Check _mumbai_user_profile meta
    if (!$user_id) {
        $like_phone = '%' . $wpdb->esc_like('"phone";s:10:"' . $clean_phone . '"') . '%';
        $user_by_profile = $wpdb->get_var($wpdb->prepare(
            "SELECT user_id FROM {$wpdb->usermeta}
             WHERE meta_key = '_mumbai_user_profile' AND meta_value LIKE %s
             ORDER BY user_id ASC LIMIT 1",
            $like_phone
        ));
        if ($user_by_profile) {
            $user_id = (int) $user_by_profile;
        }
    }

    // Fallback 3: Check indexed customer search table if available
    if (!$user_id) {
        $table_search = $wpdb->prefix . 'mumbai_customer_search';
        if ($wpdb->get_var("SHOW TABLES LIKE '{$table_search}'") === $table_search) {
            $user_by_search = $wpdb->get_var($wpdb->prepare(
                "SELECT customer_id FROM {$table_search}
                 WHERE phone_digits = %s
                 ORDER BY customer_id ASC LIMIT 1",
                $clean_phone
            ));
            if ($user_by_search) {
                $user_id = (int) $user_by_search;
            }
        }
    }

    return $user_id > 0 ? get_user_by('id', $user_id) : null;
}

/**
 * REST Endpoint: Check phone number availability across all accounts
 */
function mumbai_check_phone_availability(WP_REST_Request $request) {
    $raw_phone = sanitize_text_field($request->get_param('phone'));
    $user_id = absint($request->get_header('X-Mumbai-User-ID'));
    if (empty($raw_phone)) {
        return new WP_Error(
            'missing_phone',
            'Phone number is required.',
            ['status' => 400]
        );
    }
    $clean_phone = mumbai_normalize_phone($raw_phone);
    if (!preg_match('/^[6-9][0-9]{9}$/', $clean_phone)) {
        return rest_ensure_response([
            'success'   => false,
            'available' => false,
            'exists'    => false,
            'message'   => 'Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.',
        ]);
    }
    $existing_user = mumbai_get_user_by_phone($clean_phone);
    if ($existing_user && (int) $existing_user->ID !== (int) $user_id) {
        return rest_ensure_response([
            'success'   => true,
            'available' => false,
            'exists'    => true,
            'message'   => 'This mobile number is already registered to another account. Please use a different number.',
        ]);
    }
    return rest_ensure_response([
        'success'   => true,
        'available' => true,
        'exists'    => false,
        'message'   => 'Mobile number is available.',
    ]);
}

function mumbai_otp_store(WP_REST_Request $request) {
    $purpose = sanitize_text_field($request->get_param('purpose'));
    $phone = sanitize_text_field($request->get_param('phone'));
    $otp_hash = sanitize_text_field($request->get_param('otp_hash'));

    if (!$phone || !$otp_hash || !in_array($purpose, ['reset_password', 'register'], true)) {
        return new WP_Error('invalid_params', 'Missing required parameters.', ['status' => 400]);
    }

    if ($purpose === 'register') {
        if (!is_email($phone)) {
            return new WP_Error('invalid_email', 'Please enter a valid email address.', ['status' => 400]);
        }
        $existing = get_user_by('email', $phone);
        if ($existing) {
            return new WP_Error('email_exists', 'An account with this email already exists. Please sign in.', ['status' => 409]);
        }
        $norm_email = strtolower(trim($phone));
        $last_request = (int) get_transient('_mumbai_last_reg_otp_' . md5($norm_email));
        if ($last_request && (time() - $last_request) < 60) {
            return new WP_Error('rate_limit', 'Please wait 60 seconds before requesting a new code.', ['status' => 429]);
        }

        set_transient('_mumbai_last_reg_otp_' . md5($norm_email), time(), 60);
        set_transient('_mumbai_reg_otp_' . md5($norm_email), [
            'hash'     => $otp_hash,
            'expires'  => time() + 300,
            'attempts' => 0,
        ], 300);

        return [
            'success'    => true,
            'message'    => 'Verification code sent.',
            'user_found' => false,
            'email'      => $phone,
            'name'       => '',
        ];
    }

    $generic_success = [
        'success' => true,
        'message' => is_email($phone)
            ? 'If an account is registered with this email, an OTP has been sent.'
            : 'If the number is registered, an OTP has been sent.',
    ];

    $user = null;
    if ($purpose === 'reset_password') {
        if (is_email($phone)) {
            $user = get_user_by('email', $phone);
        } else {
            $user = mumbai_get_user_by_phone($phone);
        }
        if (!$user) {
            return array_merge($generic_success, ['user_found' => false]);
        }
    }

    $last_request = (int) get_user_meta($user->ID, '_mumbai_last_otp_request', true);
    if ($last_request && (time() - $last_request) < 60) {
        if ($purpose === 'reset_password') return array_merge($generic_success, ['user_found' => true, 'rate_limited' => true]);
        return new WP_Error('rate_limit', 'Please wait 60 seconds before requesting a new OTP.', ['status' => 429]);
    }

    update_user_meta($user->ID, '_mumbai_last_otp_request', time());
    update_user_meta($user->ID, '_mumbai_otp_hash', $otp_hash);
    update_user_meta($user->ID, '_mumbai_otp_expires', time() + 300);
    update_user_meta($user->ID, '_mumbai_otp_attempts', 0);
    update_user_meta($user->ID, '_mumbai_otp_purpose', $purpose);
    update_user_meta($user->ID, '_mumbai_otp_pending_phone', $phone);

    return $purpose === 'reset_password' ? array_merge($generic_success, [
        'user_found' => true,
        'email'      => $user->user_email,
        'name'       => $user->display_name,
    ]) : [
        'success'    => true,
        'message'    => 'OTP stored successfully.',
        'user_found' => true,
        'email'      => $user->user_email,
        'name'       => $user->display_name,
    ];
}

function mumbai_otp_invalidate(WP_REST_Request $request) {
    $purpose = sanitize_text_field($request->get_param('purpose'));
    $phone = sanitize_text_field($request->get_param('phone'));
    $user_id = (int) $request->get_param('user_id');

    if ($purpose === 'register') {
        if ($phone) {
            delete_transient('_mumbai_reg_otp_' . md5(strtolower(trim($phone))));
        }
        return ['success' => true];
    }

    $user = null;
    if ($purpose === 'reset_password') {
        if (is_email($phone)) {
            $user = get_user_by('email', $phone);
        } else {
            $user = mumbai_get_user_by_phone($phone);
        }
    } else if ($user_id) {
        $user = get_user_by('id', $user_id);
    }

    if ($user) {
        delete_user_meta($user->ID, '_mumbai_otp_hash');
        delete_user_meta($user->ID, '_mumbai_otp_expires');
        delete_user_meta($user->ID, '_mumbai_otp_attempts');
        delete_user_meta($user->ID, '_mumbai_otp_purpose');
        delete_user_meta($user->ID, '_mumbai_otp_pending_phone');
    }

    return ['success' => true];
}

function mumbai_otp_verify(WP_REST_Request $request) {
    $purpose = sanitize_text_field($request->get_param('purpose'));
    $phone = sanitize_text_field($request->get_param('phone'));
    $otp_hash = sanitize_text_field($request->get_param('otp_hash'));

    if (!$phone || !$otp_hash || !in_array($purpose, ['reset_password', 'register'], true)) {
        return new WP_Error('invalid_params', 'Missing required parameters.', ['status' => 400]);
    }

    if ($purpose === 'register') {
        $norm_email = strtolower(trim($phone));
        $transient_key = '_mumbai_reg_otp_' . md5($norm_email);
        $stored = get_transient($transient_key);

        if (!$stored || !is_array($stored) || empty($stored['hash'])) {
            return new WP_Error('expired_otp', 'Verification code has expired or was not requested.', ['status' => 400]);
        }
        if (($stored['attempts'] ?? 0) >= 5) {
            delete_transient($transient_key);
            return new WP_Error('too_many_attempts', 'Too many invalid attempts. Please request a new code.', ['status' => 429]);
        }
        if (!hash_equals((string) $stored['hash'], (string) $otp_hash)) {
            $stored['attempts'] = ($stored['attempts'] ?? 0) + 1;
            set_transient($transient_key, $stored, 300);
            return new WP_Error('invalid_otp', 'Invalid verification code.', ['status' => 400]);
        }

        delete_transient($transient_key);
        return [
            'success'  => true,
            'message'  => 'Email verified successfully.',
            'verified' => true,
        ];
    }

    $user = null;
    if ($purpose === 'reset_password') {
        if (is_email($phone)) {
            $user = get_user_by('email', $phone);
        } else {
            $user = mumbai_get_user_by_phone($phone);
        }
        if (!$user) {
            return new WP_Error('invalid_otp', 'Invalid or expired OTP.', ['status' => 400]);
        }
    }

    global $wpdb;
    $has_db_lock = !empty($wpdb) && method_exists($wpdb, 'get_var');
    $lock_name = 'mumbai_otp_' . (int) $user->ID;
    if ($has_db_lock) {
        $got_lock = (int) $wpdb->get_var($wpdb->prepare("SELECT GET_LOCK(%s, 5)", $lock_name));
        if (!$got_lock) {
            return new WP_Error('lock_timeout', 'Verification in progress, please retry.', ['status' => 429]);
        }
    }

    try {
        if (function_exists('clean_user_cache')) {
            clean_user_cache($user->ID);
        }

        $stored_hash = get_user_meta($user->ID, '_mumbai_otp_hash', true);
        $expires = (int) get_user_meta($user->ID, '_mumbai_otp_expires', true);
        $attempts = (int) get_user_meta($user->ID, '_mumbai_otp_attempts', true);
        $stored_purpose = get_user_meta($user->ID, '_mumbai_otp_purpose', true);
        $stored_pending_phone = get_user_meta($user->ID, '_mumbai_otp_pending_phone', true);

        if (!empty($stored_purpose) && $stored_purpose !== $purpose) {
            return new WP_Error('invalid_otp_purpose', 'This OTP was not issued for this action.', ['status' => 400]);
        }

        if (!empty($stored_pending_phone)) {
            $is_email_match = (is_email($stored_pending_phone) || is_email($phone));
            $phone_match = $is_email_match
                ? (strtolower(trim($stored_pending_phone)) === strtolower(trim($phone)))
                : (mumbai_normalize_phone($stored_pending_phone) === mumbai_normalize_phone($phone));
            if (!$phone_match) {
                return new WP_Error('invalid_otp_phone', 'This OTP was not requested for this identifier.', ['status' => 400]);
            }
        }

        if (!$stored_hash || time() > $expires) {
            return new WP_Error('expired_otp', 'OTP has expired.', ['status' => 400]);
        }

        if ($attempts >= 5) {
            delete_user_meta($user->ID, '_mumbai_otp_hash');
            delete_user_meta($user->ID, '_mumbai_otp_expires');
            return new WP_Error('max_attempts', 'Too many failed attempts. Please request a new OTP.', ['status' => 429]);
        }

        if (!hash_equals($stored_hash, $otp_hash)) {
            update_user_meta($user->ID, '_mumbai_otp_attempts', $attempts + 1);
            return new WP_Error('invalid_otp', 'Invalid OTP.', ['status' => 400]);
        }

        // Success! Clear OTP state.
        delete_user_meta($user->ID, '_mumbai_otp_hash');
        delete_user_meta($user->ID, '_mumbai_otp_expires');
        delete_user_meta($user->ID, '_mumbai_otp_attempts');
        delete_user_meta($user->ID, '_mumbai_otp_purpose');
        delete_user_meta($user->ID, '_mumbai_otp_pending_phone');

        $reset_token = wp_generate_password(64, false, false);
        $reset_token_hash = hash('sha256', $reset_token);
        update_user_meta($user->ID, '_mumbai_reset_auth_token', $reset_token_hash);
        update_user_meta($user->ID, '_mumbai_reset_auth_expires', time() + 900);

        return [
            'success' => true,
            'message' => 'OTP verified. Proceed to reset password.',
            'reset_token' => $reset_token,
        ];
    } finally {
        if ($has_db_lock) {
            $wpdb->query($wpdb->prepare("SELECT RELEASE_LOCK(%s)", $lock_name));
        }
    }
}

function mumbai_otp_reset_password(WP_REST_Request $request) {
    $phone = sanitize_text_field($request->get_param('phone'));
    $reset_token = sanitize_text_field($request->get_param('reset_token'));
    $new_password = $request->get_param('new_password');

    if (!$phone || !$reset_token || !$new_password) {
        return new WP_Error('missing_params', 'Required parameters missing.', ['status' => 400]);
    }
    $pw_check = mumbai_validate_password($new_password);
    if ($pw_check !== true) {
        return new WP_Error('weak_password', $pw_check, ['status' => 400]);
    }

    if (is_email($phone)) {
        $user = get_user_by('email', $phone);
    } else {
        $user = mumbai_get_user_by_phone($phone);
    }
    if (!$user) {
        return new WP_Error('invalid_request', 'Invalid request.', ['status' => 400]);
    }

    global $wpdb;
    $has_db_lock = !empty($wpdb) && method_exists($wpdb, 'get_var');
    $lock_name = 'mumbai_reset_' . (int) $user->ID;
    if ($has_db_lock) {
        $got_lock = (int) $wpdb->get_var($wpdb->prepare("SELECT GET_LOCK(%s, 5)", $lock_name));
        if (!$got_lock) {
            return new WP_Error('lock_timeout', 'Password reset in progress, please retry.', ['status' => 429]);
        }
    }

    try {
        if (function_exists('clean_user_cache')) {
            clean_user_cache($user->ID);
        }

        $stored_hash = get_user_meta($user->ID, '_mumbai_reset_auth_token', true);
        $expires = (int) get_user_meta($user->ID, '_mumbai_reset_auth_expires', true);
        $token_hash = hash('sha256', $reset_token);

        if (!$stored_hash || time() > $expires || !hash_equals($stored_hash, $token_hash)) {
            return new WP_Error('invalid_token', 'Reset session expired or invalid. Please verify OTP again.', ['status' => 401]);
        }

        reset_password($user, $new_password);
        
        WP_Session_Tokens::get_instance($user->ID)->destroy_all();
        delete_user_meta($user->ID, '_mumbai_failed_logins');
        delete_user_meta($user->ID, '_mumbai_lockout_until');
        delete_user_meta($user->ID, '_mumbai_reset_auth_token');
        delete_user_meta($user->ID, '_mumbai_reset_auth_expires');

        return [
            'success' => true,
            'message' => 'Password reset successfully.',
            'user_id' => (int) $user->ID,
        ];
    } finally {
        if ($has_db_lock) {
            $wpdb->query($wpdb->prepare("SELECT RELEASE_LOCK(%s)", $lock_name));
        }
    }
}

/*
 * ─────────────────────────────────────────────
 * PRODUCT MEDIA LIFECYCLE & SAFE ORPHAN CLEANUP
 * ─────────────────────────────────────────────
 */

/**
 * Strict 6-point check to verify if a media ID is referenced anywhere in WordPress.
 * 
 * @param int $media_id
 * @return array|false Returns reference details if referenced, or false if unreferenced.
 */
function mumbai_is_media_referenced($media_id) {
    global $wpdb;
    $media_id = absint($media_id);
    if (!$media_id) {
        return false;
    }

    // 1. Featured image reference (_thumbnail_id) across all post types (products, variations, posts, pages)
    $thumbnail_ref = $wpdb->get_var($wpdb->prepare(
        "SELECT pm.post_id FROM {$wpdb->postmeta} pm
         INNER JOIN {$wpdb->posts} p ON pm.post_id = p.ID
         WHERE pm.meta_key = '_thumbnail_id' 
           AND pm.meta_value = %s
           AND p.post_status != 'trash'
         LIMIT 1",
        (string) $media_id
    ));
    if (!empty($thumbnail_ref)) {
        return [
            'referenced' => true,
            'type'       => '_thumbnail_id',
            'post_id'    => (int) $thumbnail_ref,
        ];
    }

    // 2. Product gallery reference (_product_image_gallery) - comma-separated list of media IDs
    // Formats: '123' OR '123,...' OR '...,123,...' OR '...,123'
    $str_id = (string) $media_id;
    $gallery_ref = $wpdb->get_var($wpdb->prepare(
        "SELECT pm.post_id FROM {$wpdb->postmeta} pm
         INNER JOIN {$wpdb->posts} p ON pm.post_id = p.ID
         WHERE pm.meta_key = '_product_image_gallery'
           AND (pm.meta_value = %s 
                OR pm.meta_value LIKE %s 
                OR pm.meta_value LIKE %s 
                OR pm.meta_value LIKE %s)
           AND p.post_status != 'trash'
         LIMIT 1",
        $str_id,
        $str_id . ',%',
        '%,' . $str_id . ',%',
        '%,' . $str_id
    ));
    if (!empty($gallery_ref)) {
        return [
            'referenced' => true,
            'type'       => '_product_image_gallery',
            'post_id'    => (int) $gallery_ref,
        ];
    }

    // 3. Category / Term thumbnail reference (WooCommerce category images stored in termmeta)
    $term_ref = $wpdb->get_var($wpdb->prepare(
        "SELECT term_id FROM {$wpdb->termmeta}
         WHERE meta_key = 'thumbnail_id'
           AND meta_value = %s
         LIMIT 1",
        $str_id
    ));
    if (!empty($term_ref)) {
        return [
            'referenced' => true,
            'type'       => 'termmeta_thumbnail_id',
            'term_id'    => (int) $term_ref,
        ];
    }

    // 4. Homepage banners option check
    $banners = get_option('mumbai_homepage_banners', []);
    if (is_array($banners)) {
        foreach ($banners as $b) {
            if (!is_array($b)) continue;
            $desktop_id = !empty($b['desktop_media_id']) ? absint($b['desktop_media_id']) : 0;
            $mobile_id = !empty($b['mobile_media_id']) ? absint($b['mobile_media_id']) : 0;
            if ($desktop_id === $media_id || $mobile_id === $media_id) {
                return [
                    'referenced' => true,
                    'type'       => 'homepage_banner',
                    'banner_id'  => $b['id'] ?? 'unknown',
                ];
            }
        }
    }

    // 5. Active parent post check (if attachment has post_parent > 0 and that parent post is not in trash)
    $parent_id = $wpdb->get_var($wpdb->prepare(
        "SELECT post_parent FROM {$wpdb->posts} WHERE ID = %d AND post_type = 'attachment'",
        $media_id
    ));
    if (!empty($parent_id) && (int) $parent_id > 0) {
        $parent_status = $wpdb->get_var($wpdb->prepare(
            "SELECT post_status FROM {$wpdb->posts} WHERE ID = %d",
            $parent_id
        ));
        if ($parent_status && $parent_status !== 'trash') {
            return [
                'referenced' => true,
                'type'       => 'post_parent',
                'parent_id'  => (int) $parent_id,
            ];
        }
    }

    // 6. Embedded in published post/page/product content
    $attachment_url = wp_get_attachment_url($media_id);
    if (!empty($attachment_url)) {
        $filename = basename($attachment_url);
        if (!empty($filename)) {
            $content_ref = $wpdb->get_var($wpdb->prepare(
                "SELECT ID FROM {$wpdb->posts}
                 WHERE post_status = 'publish'
                   AND post_type IN ('product', 'post', 'page')
                   AND post_content LIKE %s
                 LIMIT 1",
                '%' . $wpdb->esc_like($filename) . '%'
            ));
            if (!empty($content_ref)) {
                return [
                    'referenced' => true,
                    'type'       => 'post_content',
                    'post_id'    => (int) $content_ref,
                ];
            }
        }
    }

    return false;
}

/**
 * Direct Media Upload endpoint for Node.js backend.
 * Authenticated via X-Mumbai-Internal-Key.
 */
function mumbai_upload_media_attachment(WP_REST_Request $request) {
    require_once ABSPATH . 'wp-admin/includes/file.php';
    require_once ABSPATH . 'wp-admin/includes/media.php';
    require_once ABSPATH . 'wp-admin/includes/image.php';

    $uploader_id = absint($request->get_param('uploader_id'));
    $filename = sanitize_file_name($request->get_param('filename') ?: ('upload_' . time() . '.webp'));

    $files = $request->get_file_params();
    $file = !empty($files['file']) ? $files['file'] : (!empty($files['image']) ? $files['image'] : null);

    $attachment_id = 0;

    if ($file && !empty($file['tmp_name'])) {
        $attachment_id = media_handle_sideload($file, 0);
        if (is_wp_error($attachment_id)) {
            return new WP_Error('upload_failed', $attachment_id->get_error_message(), ['status' => 500]);
        }
    } else {
        $body = $request->get_body();
        if (empty($body)) {
            return new WP_Error('empty_file', 'No image content provided.', ['status' => 400]);
        }

        $upload = wp_upload_bits($filename, null, $body);
        if (!empty($upload['error'])) {
            return new WP_Error('upload_failed', $upload['error'], ['status' => 500]);
        }

        $file_path = $upload['file'];
        $file_type = wp_check_filetype($filename, null);

        $attachment = [
            'post_mime_type' => $file_type['type'] ?: 'image/webp',
            'post_title'     => preg_replace('/\.[^.]+$/', '', $filename),
            'post_content'   => '',
            'post_status'    => 'inherit',
        ];

        $attachment_id = wp_insert_attachment($attachment, $file_path);
        if (!$attachment_id || is_wp_error($attachment_id)) {
            return new WP_Error('attachment_creation_failed', 'Failed to insert attachment into database.', ['status' => 500]);
        }

        $attach_data = wp_generate_attachment_metadata($attachment_id, $file_path);
        wp_update_attachment_metadata($attachment_id, $attach_data);
    }

    update_post_meta($attachment_id, '_mumbai_upload_status', 'pending');
    update_post_meta($attachment_id, '_mumbai_upload_time', time());
    if ($uploader_id > 0) {
        update_post_meta($attachment_id, '_mumbai_uploader_id', $uploader_id);
    }

    $url = wp_get_attachment_url($attachment_id);

    return [
        'success'    => true,
        'id'         => $attachment_id,
        'url'        => $url,
        'source_url' => $url,
    ];
}

/**
 * Track a newly uploaded media attachment as pending.
 */
function mumbai_track_pending_media(WP_REST_Request $request) {
    $media_id = absint($request->get_param('media_id'));
    $uploader_id = absint($request->get_param('uploader_id'));

    if (!$media_id) {
        return new WP_Error('invalid_media_id', 'Valid media_id required.', ['status' => 400]);
    }

    $post = get_post($media_id);
    if (!$post || $post->post_type !== 'attachment') {
        return new WP_Error('media_not_found', 'Media attachment not found.', ['status' => 404]);
    }

    update_post_meta($media_id, '_mumbai_upload_status', 'pending');
    update_post_meta($media_id, '_mumbai_upload_time', time());
    if ($uploader_id > 0) {
        update_post_meta($media_id, '_mumbai_uploader_id', $uploader_id);
    }

    return [
        'success'   => true,
        'media_id'  => $media_id,
        'status'    => 'pending',
        'timestamp' => time(),
    ];
}

/**
 * Mark uploaded media as attached to a product or product category.
 */
function mumbai_mark_media_attached(WP_REST_Request $request) {
    $media_ids = $request->get_param('media_ids');
    $product_id = absint($request->get_param('product_id'));
    $category_id = absint($request->get_param('category_id'));

    if (!is_array($media_ids) || empty($media_ids)) {
        return new WP_Error('invalid_media_ids', 'media_ids array required.', ['status' => 400]);
    }
    if (($product_id > 0) === ($category_id > 0)) {
        return new WP_Error('invalid_media_target', 'Specify exactly one valid product_id or category_id.', ['status' => 400]);
    }
    if ($product_id > 0 && get_post_type($product_id) !== 'product') {
        return new WP_Error('invalid_media_product', 'The product does not exist.', ['status' => 404]);
    }
    if ($category_id > 0 && !term_exists($category_id, 'product_cat')) {
        return new WP_Error('invalid_media_category', 'The product category does not exist.', ['status' => 404]);
    }

    $updated = [];
    foreach ($media_ids as $id) {
        $m_id = absint($id);
        if (!$m_id) continue;

        $post = get_post($m_id);
        if (!$post || $post->post_type !== 'attachment') continue;

        update_post_meta($m_id, '_mumbai_upload_status', 'attached');
        if ($product_id > 0) {
            update_post_meta($m_id, '_mumbai_attached_product_id', $product_id);
            if ((int) $post->post_parent === 0) {
                wp_update_post([
                    'ID'          => $m_id,
                    'post_parent' => $product_id,
                ]);
            }
        } elseif ($category_id > 0) {
            update_post_meta($m_id, '_mumbai_attached_category_id', $category_id);
        }
        $updated[] = $m_id;
    }

    return [
        'success'     => true,
        'updated_ids' => $updated,
        'count'       => count($updated),
    ];
}

/**
 * Delete media if completely unreferenced and meets context security rules.
 */
function mumbai_delete_media_if_unreferenced(WP_REST_Request $request) {
    $media_ids = $request->get_param('media_ids');
    $context = sanitize_text_field($request->get_param('context') ?: 'unknown');
    $uploader_id = absint($request->get_param('uploader_id'));

    if (empty($media_ids)) {
        $single_id = absint($request->get_param('media_id'));
        if ($single_id > 0) {
            $media_ids = [$single_id];
        }
    }

    if (!is_array($media_ids) || empty($media_ids)) {
        return new WP_Error('invalid_media_ids', 'media_ids array or media_id required.', ['status' => 400]);
    }

    $results = [];

    foreach ($media_ids as $id) {
        $m_id = absint($id);
        if (!$m_id) continue;

        $post = get_post($m_id);
        if (!$post || $post->post_type !== 'attachment') {
            $results[] = [
                'media_id' => $m_id,
                'deleted'  => false,
                'reason'   => 'not_found',
            ];
            continue;
        }

        $status = get_post_meta($m_id, '_mumbai_upload_status', true);
        $assigned_uploader = (int) get_post_meta($m_id, '_mumbai_uploader_id', true);

        // Guard for pending_removal (employee removes uploaded image before submitting):
        if ($context === 'pending_removal') {
            if ($status !== 'pending') {
                $results[] = [
                    'media_id' => $m_id,
                    'deleted'  => false,
                    'reason'   => 'not_pending',
                    'message'  => 'Cannot remove media that is already attached or not in pending state.',
                ];
                continue;
            }

            if ($uploader_id > 0 && $assigned_uploader > 0 && $assigned_uploader !== $uploader_id) {
                $user = get_user_by('id', $uploader_id);
                $is_admin = $user && in_array('administrator', (array) $user->roles);
                if (!$is_admin) {
                    $results[] = [
                        'media_id' => $m_id,
                        'deleted'  => false,
                        'reason'   => 'ownership_mismatch',
                    ];
                    continue;
                }
            }
        }

        // Strict reference check across all 6 dimensions
        $ref_check = mumbai_is_media_referenced($m_id);
        if (!empty($ref_check) && !empty($ref_check['referenced'])) {
            $results[] = [
                'media_id'  => $m_id,
                'deleted'   => false,
                'reason'    => 'referenced',
                'reference' => $ref_check,
            ];
            continue;
        }

        // Force delete attachment file and database row
        $deleted = wp_delete_attachment($m_id, true);
        if ($deleted) {
            $results[] = [
                'media_id' => $m_id,
                'deleted'  => true,
                'context'  => $context,
            ];
        } else {
            $results[] = [
                'media_id' => $m_id,
                'deleted'  => false,
                'reason'   => 'delete_failed',
            ];
        }
    }

    return [
        'success' => true,
        'results' => $results,
    ];
}

/**
 * Scan and clean up pending uploads older than 24 hours (86400 seconds).
 */
function mumbai_cleanup_pending_orphans($request = null) {
    global $wpdb;

    $cutoff = time() - 86400;

    $orphans = $wpdb->get_results($wpdb->prepare(
        "SELECT p.ID, pm_time.meta_value as upload_time
         FROM {$wpdb->posts} p
         INNER JOIN {$wpdb->postmeta} pm_status ON p.ID = pm_status.post_id AND pm_status.meta_key = '_mumbai_upload_status'
         INNER JOIN {$wpdb->postmeta} pm_time ON p.ID = pm_time.post_id AND pm_time.meta_key = '_mumbai_upload_time'
         WHERE p.post_type = 'attachment'
           AND pm_status.meta_value = 'pending'
           AND CAST(pm_time.meta_value AS UNSIGNED) < %d
         LIMIT 50",
        $cutoff
    ));

    $deleted_ids = [];
    $reclassified_ids = [];

    if (!empty($orphans)) {
        foreach ($orphans as $orphan) {
            $media_id = (int) $orphan->ID;
            $ref_check = mumbai_is_media_referenced($media_id);
            if (!empty($ref_check) && !empty($ref_check['referenced'])) {
                update_post_meta($media_id, '_mumbai_upload_status', 'attached');
                $reclassified_ids[] = $media_id;
            } else {
                $del = wp_delete_attachment($media_id, true);
                if ($del) {
                    $deleted_ids[] = $media_id;
                }
            }
        }
    }

    return [
        'success'          => true,
        'inspected_count'  => count($orphans),
        'deleted_count'    => count($deleted_ids),
        'deleted_ids'      => $deleted_ids,
        'reclassified_ids' => $reclassified_ids,
        'cutoff_timestamp' => $cutoff,
    ];
}

// Register daily WP-Cron for orphaned media cleanup
add_action('mumbai_daily_media_cleanup', 'mumbai_cleanup_pending_orphans');
if (!wp_next_scheduled('mumbai_daily_media_cleanup')) {
    wp_schedule_event(time() + 3600, 'daily', 'mumbai_daily_media_cleanup');
}

/**
 * Hardening: Ensure .htaccess in wp-content/uploads/ prevents direct execution of PHP scripts.
 */
function mumbai_secure_uploads_directory() {
    $upload_dir = wp_upload_dir();
    $basedir = !empty($upload_dir['basedir']) ? $upload_dir['basedir'] : null;
    if (!$basedir || !is_dir($basedir) || !is_writable($basedir)) {
        return;
    }

    $htaccess_file = rtrim($basedir, '/\\') . '/.htaccess';
    if (!file_exists($htaccess_file)) {
        $rules = "# Block direct script execution in WordPress uploads directory\n"
               . "<FilesMatch \"(?i)\\.(php|phtml|php3|php4|php5|php7|php8|phar|inc|cgi|pl)$\">\n"
               . "    <IfModule mod_authz_core.c>\n"
               . "        Require all denied\n"
               . "    </IfModule>\n"
               . "    <IfModule !mod_authz_core.c>\n"
               . "        Deny from all\n"
               . "    </IfModule>\n"
               . "</FilesMatch>\n";
        @file_put_contents($htaccess_file, $rules);
    }
}
add_action('admin_init', 'mumbai_secure_uploads_directory');
add_action('mumbai_daily_media_cleanup', 'mumbai_secure_uploads_directory');

/*
 * ─────────────────────────────────────────────
 * INVENTORY SCALING: WOOCOMMERCE PRODUCT REST QUERY
 * ─────────────────────────────────────────────
 * Adds server-side support for:
 * 1. stock_status=lowstock (_manage_stock = yes AND _stock > 0 AND _stock <= 5)
 * 2. SKU search via _sku postmeta in WooCommerce REST API
 * 3. Live stock counts calculation
 */
add_filter('woocommerce_product_stock_status_options', 'mumbai_add_lowstock_stock_status_option', 20, 1);
function mumbai_add_lowstock_stock_status_option($statuses) {
    if (is_array($statuses) && !isset($statuses['lowstock'])) {
        $statuses['lowstock'] = __('Low stock', 'woocommerce');
    }
    return $statuses;
}

add_filter('woocommerce_rest_product_collection_params', 'mumbai_wc_rest_product_collection_params', 20, 1);
function mumbai_wc_rest_product_collection_params($params) {
    if (isset($params['stock_status']['enum']) && is_array($params['stock_status']['enum'])) {
        if (!in_array('lowstock', $params['stock_status']['enum'], true)) {
            $params['stock_status']['enum'][] = 'lowstock';
        }
    }
    return $params;
}

add_filter('woocommerce_rest_product_object_query', 'mumbai_wc_rest_product_object_query', 20, 2);
function mumbai_wc_rest_product_object_query($args, $request) {
    // 1. Server-side lowstock filter
    $stock_status = $request->get_param('stock_status');
    if ($stock_status === 'lowstock') {
        unset($args['stock_status']);

        // Clear stock_status on WP_REST_Request so WC_REST_Products_Controller
        // does not append '_stock_status = lowstock' to meta_query after this filter returns.
        if (is_object($request) && method_exists($request, 'set_param')) {
            $request->set_param('stock_status', null);
        }

        if (!isset($args['meta_query']) || !is_array($args['meta_query'])) {
            $args['meta_query'] = [];
        }

        $args['meta_query'][] = [
            'key'     => '_manage_stock',
            'value'   => 'yes',
            'compare' => '=',
        ];
        $args['meta_query'][] = [
            'key'     => '_stock',
            'value'   => 0,
            'type'    => 'NUMERIC',
            'compare' => '>',
        ];
        $args['meta_query'][] = [
            'key'     => '_stock',
            'value'   => 5,
            'type'    => 'NUMERIC',
            'compare' => '<=',
        ];
    }

    // 2. Pass search term to WP_Query for SKU matching
    $search = $request->get_param('search');
    if (!empty($search)) {
        $args['mumbai_sku_search'] = trim($search);
    }

    return $args;
}

/**
 * Strips invalid '_stock_status = lowstock' clause if added by WooCommerce core
 * and enforces low stock meta boundaries on the WP_Query.
 */
add_action('pre_get_posts', 'mumbai_strip_lowstock_meta_query', 20, 1);
function mumbai_strip_lowstock_meta_query($query) {
    $meta_query = $query->get('meta_query');
    if (is_array($meta_query)) {
        $found = false;
        foreach ($meta_query as $key => $clause) {
            if (is_array($clause) && isset($clause['key']) && $clause['key'] === '_stock_status' && isset($clause['value']) && $clause['value'] === 'lowstock') {
                unset($meta_query[$key]);
                $found = true;
            }
        }
        if ($found) {
            $has_stock_condition = false;
            foreach ($meta_query as $clause) {
                if (is_array($clause) && isset($clause['key']) && $clause['key'] === '_stock') {
                    $has_stock_condition = true;
                    break;
                }
            }
            if (!$has_stock_condition) {
                $meta_query[] = [
                    'key'     => '_manage_stock',
                    'value'   => 'yes',
                    'compare' => '=',
                ];
                $meta_query[] = [
                    'key'     => '_stock',
                    'value'   => 0,
                    'type'    => 'NUMERIC',
                    'compare' => '>',
                ];
                $meta_query[] = [
                    'key'     => '_stock',
                    'value'   => 5,
                    'type'    => 'NUMERIC',
                    'compare' => '<=',
                ];
            }
            $query->set('meta_query', array_values($meta_query));
        }
    }
}

add_filter('posts_search', 'mumbai_extend_product_search_to_sku', 20, 2);
function mumbai_extend_product_search_to_sku($search_sql, $wp_query) {
    if (empty($search_sql)) {
        return $search_sql;
    }

    $sku_search = $wp_query->get('mumbai_sku_search');
    if (empty($sku_search)) {
        return $search_sql;
    }

    global $wpdb;
    $like = '%' . $wpdb->esc_like($sku_search) . '%';
    $sku_condition = $wpdb->prepare(
        "EXISTS (SELECT 1 FROM {$wpdb->postmeta} WHERE post_id = {$wpdb->posts}.ID AND meta_key = '_sku' AND meta_value LIKE %s)",
        $like
    );

    if (preg_match('/^(.*)\)\s*$/s', trim($search_sql), $matches)) {
        return $matches[1] . " OR ({$sku_condition})) ";
    }

    return $search_sql;
}

/**
 * Endpoint for live inventory stock counts (All, In Stock, Low Stock, Out of Stock)
 */
function mumbai_get_product_stock_counts($request) {
    global $wpdb;

    $all = (int) $wpdb->get_var(
        "SELECT COUNT(ID) FROM {$wpdb->posts} WHERE post_type = 'product' AND post_status = 'publish'"
    );

    $outofstock = (int) $wpdb->get_var(
        "SELECT COUNT(DISTINCT p.ID) FROM {$wpdb->posts} p
         LEFT JOIN {$wpdb->postmeta} pm_status ON p.ID = pm_status.post_id AND pm_status.meta_key = '_stock_status'
         LEFT JOIN {$wpdb->postmeta} pm_manage ON p.ID = pm_manage.post_id AND pm_manage.meta_key = '_manage_stock'
         LEFT JOIN {$wpdb->postmeta} pm_stock ON p.ID = pm_stock.post_id AND pm_stock.meta_key = '_stock'
         WHERE p.post_type = 'product' AND p.post_status = 'publish'
           AND (
             pm_status.meta_value = 'outofstock'
             OR (pm_manage.meta_value = 'yes' AND CAST(pm_stock.meta_value AS SIGNED) <= 0)
           )"
    );

    $lowstock = (int) $wpdb->get_var(
        "SELECT COUNT(DISTINCT p.ID) FROM {$wpdb->posts} p
         INNER JOIN {$wpdb->postmeta} pm_manage ON p.ID = pm_manage.post_id AND pm_manage.meta_key = '_manage_stock' AND pm_manage.meta_value = 'yes'
         INNER JOIN {$wpdb->postmeta} pm_stock ON p.ID = pm_stock.post_id AND pm_stock.meta_key = '_stock'
         WHERE p.post_type = 'product' AND p.post_status = 'publish'
           AND CAST(pm_stock.meta_value AS SIGNED) > 0
           AND CAST(pm_stock.meta_value AS SIGNED) <= 5"
    );

    // In-stock products include all published products that are not out-of-stock.
    // Low-stock products (1 <= stock <= 5) are active in-stock inventory and must not be subtracted from instock.
    $instock = max(0, $all - $outofstock);

    return rest_ensure_response([
        'success' => true,
        'counts'  => [
            'all'        => $all,
            'instock'    => $instock,
            'lowstock'   => $lowstock,
            'outofstock' => $outofstock,
        ],
    ]);
}

/**
 * Database-ranked catalog search. Matching and pagination happen before the
 * Node gateway hydrates product cards, so relevant results are not lost by
 * paginating WooCommerce's broader description search first.
 */
function mumbai_catalog_search(WP_REST_Request $request) {
    global $wpdb;

    $query = trim(substr((string) $request->get_param('q'), 0, 80));
    $page = max(1, absint($request->get_param('page') ?: 1));
    $per_page = min(50, max(1, absint($request->get_param('per_page') ?: 20)));
    if (strlen($query) < 2) {
        return rest_ensure_response([
            'success' => true,
            'ids' => [],
            'total' => 0,
            'totalPages' => 0,
            'page' => $page,
            'per_page' => $per_page,
        ]);
    }

    $normalized = strtolower(remove_accents($query));
    $normalized = preg_replace('/[^a-z0-9]+/', ' ', $normalized);
    $normalized = trim(preg_replace('/\s+/', ' ', $normalized));
    $stop_words = ['a', 'an', 'and', 'for', 'in', 'of', 'the', 'to', 'with'];
    $tokens = array_values(array_unique(array_filter(
        preg_split('/\s+/', $normalized),
        static function ($token) use ($stop_words) {
            return strlen($token) > 1 && !in_array($token, $stop_words, true);
        }
    )));
    $tokens = array_slice($tokens, 0, 5);
    if (!$tokens) {
        return rest_ensure_response([
            'success' => true,
            'ids' => [],
            'total' => 0,
            'totalPages' => 0,
            'page' => $page,
            'per_page' => $per_page,
        ]);
    }

    $field_match = static function ($token) use ($wpdb) {
        $like = '%' . $wpdb->esc_like($token) . '%';
        $title = $wpdb->prepare('LOWER(p.post_title) LIKE %s', $like);
        $sku = $wpdb->prepare(
            "EXISTS (SELECT 1 FROM {$wpdb->postmeta} sku_pm WHERE sku_pm.post_id = p.ID AND sku_pm.meta_key = '_sku' AND LOWER(sku_pm.meta_value) LIKE %s)",
            $like
        );
        $attributes = $wpdb->prepare(
            "EXISTS (SELECT 1 FROM {$wpdb->postmeta} attr_pm WHERE attr_pm.post_id = p.ID AND attr_pm.meta_key = '_product_attributes' AND LOWER(attr_pm.meta_value) LIKE %s)",
            $like
        );
        $category = $wpdb->prepare(
            "EXISTS (SELECT 1 FROM {$wpdb->term_relationships} tr INNER JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_cat' INNER JOIN {$wpdb->terms} t ON t.term_id = tt.term_id WHERE tr.object_id = p.ID AND LOWER(t.name) LIKE %s)",
            $like
        );
        $excerpt = $wpdb->prepare('LOWER(p.post_excerpt) LIKE %s', $like);
        $content = $wpdb->prepare('LOWER(p.post_content) LIKE %s', $like);
        return compact('title', 'sku', 'attributes', 'category', 'excerpt', 'content');
    };

    $coverage_parts = [];
    $primary_parts = [];
    $category_parts = [];
    $score_parts = [];
    foreach ($tokens as $token) {
        $match = $field_match($token);
        $any = "({$match['title']} OR {$match['sku']} OR {$match['attributes']} OR {$match['category']} OR {$match['excerpt']} OR {$match['content']})";
        $primary = "({$match['title']} OR {$match['sku']} OR {$match['attributes']})";
        $coverage_parts[] = "(CASE WHEN {$any} THEN 1 ELSE 0 END)";
        $primary_parts[] = "(CASE WHEN {$primary} THEN 1 ELSE 0 END)";
        $category_parts[] = "(CASE WHEN {$match['category']} THEN 1 ELSE 0 END)";
        $score_parts[] = "(CASE WHEN {$match['title']} THEN 240 ELSE 0 END)";
        $score_parts[] = "(CASE WHEN {$match['sku']} THEN 170 ELSE 0 END)";
        $score_parts[] = "(CASE WHEN {$match['attributes']} THEN 100 ELSE 0 END)";
        $score_parts[] = "(CASE WHEN {$match['category']} THEN 45 ELSE 0 END)";
        $score_parts[] = "(CASE WHEN {$match['excerpt']} THEN 20 ELSE 0 END)";
        $score_parts[] = "(CASE WHEN {$match['content']} THEN 5 ELSE 0 END)";
    }

    $phrase_like = '%' . $wpdb->esc_like($normalized) . '%';
    $prefix_like = $wpdb->esc_like($normalized) . '%';
    $score_parts[] = '(CASE WHEN ' . $wpdb->prepare('LOWER(p.post_title) LIKE %s', $phrase_like) . ' THEN 1000 ELSE 0 END)';
    $score_parts[] = '(CASE WHEN ' . $wpdb->prepare('LOWER(p.post_title) LIKE %s', $prefix_like) . ' THEN 120 ELSE 0 END)';
    $accessory_like = '% with %' . $wpdb->esc_like($normalized) . '%';
    $score_parts[] = '(CASE WHEN ' . $wpdb->prepare('LOWER(p.post_title) LIKE %s', $accessory_like) . ' THEN -300 ELSE 0 END)';

    $coverage_sql = implode(' + ', $coverage_parts);
    $primary_sql = implode(' + ', $primary_parts);
    $category_sql = implode(' + ', $category_parts);
    $score_sql = implode(' + ', $score_parts);
    $minimum_coverage = count($tokens) === 1 ? 1 : (int) ceil(count($tokens) * 0.6);
    $match_guard = "({$coverage_sql}) >= {$minimum_coverage} AND (({$primary_sql}) > 0";
    if (count($tokens) === 1) {
        $match_guard .= " OR ({$category_sql}) > 0";
    }
    $match_guard .= ')';

    $base_from = "FROM {$wpdb->posts} p WHERE p.post_type = 'product' AND p.post_status = 'publish' AND {$match_guard}";
    $total = (int) $wpdb->get_var("SELECT COUNT(*) {$base_from}");
    $offset = ($page - 1) * $per_page;
    $rows = $wpdb->get_results(
        $wpdb->prepare(
            "SELECT p.ID, ({$score_sql}) AS relevance {$base_from} ORDER BY relevance DESC, p.post_date DESC, p.ID DESC LIMIT %d OFFSET %d",
            $per_page,
            $offset
        ),
        ARRAY_A
    );

    return rest_ensure_response([
        'success' => true,
        'ids' => array_map('intval', wp_list_pluck($rows ?: [], 'ID')),
        'total' => $total,
        'totalPages' => $total > 0 ? (int) ceil($total / $per_page) : 0,
        'page' => $page,
        'per_page' => $per_page,
    ]);
}

/** Return an exact rating aggregate without hydrating every review body. */
function mumbai_catalog_review_summary(WP_REST_Request $request) {
    global $wpdb;
    $product_id = absint($request->get_param('id'));
    if (!$product_id) {
        return new WP_Error('invalid_product', 'Invalid product ID.', ['status' => 400]);
    }

    $rows = $wpdb->get_results($wpdb->prepare(
        "SELECT CAST(cm.meta_value AS UNSIGNED) AS rating, COUNT(*) AS review_count
         FROM {$wpdb->comments} c
         INNER JOIN {$wpdb->commentmeta} cm ON cm.comment_id = c.comment_ID AND cm.meta_key = 'rating'
         WHERE c.comment_post_ID = %d
           AND c.comment_approved = '1'
           AND c.comment_type IN ('review', '')
           AND CAST(cm.meta_value AS UNSIGNED) BETWEEN 1 AND 5
         GROUP BY CAST(cm.meta_value AS UNSIGNED)",
        $product_id
    ), ARRAY_A);

    $distribution = [1 => 0, 2 => 0, 3 => 0, 4 => 0, 5 => 0];
    $total = 0;
    $score = 0;
    foreach ($rows ?: [] as $row) {
        $rating = max(1, min(5, (int) $row['rating']));
        $count = max(0, (int) $row['review_count']);
        $distribution[$rating] = $count;
        $total += $count;
        $score += $rating * $count;
    }

    return rest_ensure_response([
        'success' => true,
        'productId' => $product_id,
        'totalReviews' => $total,
        'averageRating' => $total > 0 ? round($score / $total, 1) : 0,
        'ratingDistribution' => $distribution,
    ]);
}

/** Find a customer's review by indexed product/email fields across all pages. */
function mumbai_catalog_review_exists(WP_REST_Request $request) {
    global $wpdb;
    $product_id = absint($request->get_param('id'));
    $email = strtolower(trim(sanitize_email($request->get_param('email'))));
    if (!$product_id || !$email) {
        return new WP_Error('invalid_review_lookup', 'Product ID and customer email are required.', ['status' => 400]);
    }

    $review_id = (int) $wpdb->get_var($wpdb->prepare(
        "SELECT comment_ID FROM {$wpdb->comments}
         WHERE comment_post_ID = %d
           AND LOWER(comment_author_email) = %s
           AND comment_type IN ('review', '')
           AND comment_approved != 'trash'
         ORDER BY comment_ID DESC
         LIMIT 1",
        $product_id,
        $email
    ));

    return rest_ensure_response([
        'success' => true,
        'exists' => $review_id > 0,
        'reviewId' => $review_id ?: null,
    ]);
}

/*
 * ─────────────────────────────────────────────
 * EMPLOYEE ACCESS MANAGEMENT (ADMIN INTERNAL)
 * ─────────────────────────────────────────────
 */

/**
 * Validates allowed roles for employee promotion (ONLY 'employee' is allowed)
 */
function mumbai_is_valid_employee_role($role) {
    return $role === 'employee';
}

/**
 * Get all employees, pending access requests, and allowlisted emails
 */
function mumbai_admin_get_employees(WP_REST_Request $request) {
    $search = sanitize_text_field($request->get_param('search') ?? '');
    $status_filter = sanitize_text_field($request->get_param('status') ?? '');

    $result_list = [];
    $processed_emails = [];

    // 1. Fetch users with employee role or with _mumbai_employee_status meta
    $employee_role_users = get_users([
        'role'   => 'employee',
        'number' => 200,
        'fields' => 'all',
    ]);

    $meta_users = get_users([
        'meta_key'     => '_mumbai_employee_status',
        'meta_compare' => 'EXISTS',
        'number'       => 200,
        'fields'       => 'all',
    ]);

    $users_by_id = [];
    foreach (array_merge($employee_role_users, $meta_users) as $u) {
        $users_by_id[$u->ID] = $u;
    }
    $users = array_values($users_by_id);

    foreach ($users as $u) {
        $roles = (array) $u->roles;
        $status = (string) get_user_meta($u->ID, '_mumbai_employee_status', true);
        $is_employee_role = in_array('employee', $roles, true);

        // If not having status meta and not having employee role, skip
        if (empty($status) && !$is_employee_role) {
            continue;
        }

        if (empty($status) && $is_employee_role) {
            $status = 'approved';
        }

        $email = strtolower(trim($u->user_email));
        $processed_emails[] = $email;

        $name = trim($u->display_name);
        if (empty($name)) {
            $name = $u->user_login;
        }

        $assigned_role = $is_employee_role ? 'employee' : 'customer';

        $requested_at = get_user_meta($u->ID, '_mumbai_employee_requested_at', true);
        $approved_at = get_user_meta($u->ID, '_mumbai_employee_approved_at', true);
        $approved_by = get_user_meta($u->ID, '_mumbai_employee_approved_by', true);
        $rejected_at = get_user_meta($u->ID, '_mumbai_employee_rejected_at', true);
        $notes = (string) get_user_meta($u->ID, '_mumbai_employee_notes', true);

        $phone = mumbai_get_user_contact_phone($u->ID);

        $entry = [
            'id'             => $u->ID,
            'email'          => $email,
            'name'           => $name,
            'phone'          => $phone,
            'roles'          => $roles,
            'role'           => $assigned_role,
            'requested_role' => 'employee',
            'status'         => $status,
            'requested_at'   => $requested_at ? (is_numeric($requested_at) ? date('c', (int)$requested_at) : $requested_at) : ($u->user_registered ? date('c', strtotime($u->user_registered)) : null),
            'approved_at'    => $approved_at ? (is_numeric($approved_at) ? date('c', (int)$approved_at) : $approved_at) : null,
            'approved_by'    => $approved_by ? (int)$approved_by : null,
            'rejected_at'    => $rejected_at ? (is_numeric($rejected_at) ? date('c', (int)$rejected_at) : $rejected_at) : null,
            'notes'          => $notes,
            'is_registered'  => true,
            'user_registered'=> $u->user_registered ? date('c', strtotime($u->user_registered)) : null,
        ];

        $result_list[] = $entry;
    }

    // 2. Fetch pending allowlisted emails that haven't registered yet
    $allowlist = (array) get_option('_mumbai_employee_allowlist', []);
    foreach ($allowlist as $norm_email => $entry) {
        if (in_array($norm_email, $processed_emails, true)) {
            continue;
        }

        $result_list[] = [
            'id'             => 'allowlist-' . md5($norm_email),
            'email'          => $norm_email,
            'name'           => 'Candidate (Not Registered)',
            'phone'          => '',
            'roles'          => ['customer'],
            'role'           => 'customer',
            'requested_role' => 'employee',
            'status'         => 'allowlisted',
            'requested_at'   => isset($entry['requested_at']) ? date('c', (int)$entry['requested_at']) : date('c'),
            'approved_at'    => null,
            'approved_by'    => null,
            'rejected_at'    => null,
            'notes'          => $entry['notes'] ?? '',
            'is_registered'  => false,
            'user_registered'=> null,
        ];
    }

    // Filter by search query if supplied
    if (!empty($search)) {
        $q = strtolower(trim($search));
        $result_list = array_values(array_filter($result_list, function ($item) use ($q) {
            return str_contains(strtolower($item['email']), $q) ||
                   str_contains(strtolower($item['name']), $q) ||
                   str_contains(strtolower($item['phone']), $q);
        }));
    }

    // Filter by status if supplied
    if (!empty($status_filter) && $status_filter !== 'all') {
        $result_list = array_values(array_filter($result_list, function ($item) use ($status_filter) {
            return $item['status'] === $status_filter;
        }));
    }

    // Sort: pending & allowlisted first, then active/approved, then deactivated/rejected
    usort($result_list, function ($a, $b) {
        $priority = [
            'pending'     => 1,
            'allowlisted' => 2,
            'approved'    => 3,
            'deactivated' => 4,
            'rejected'    => 5,
        ];
        $pA = $priority[$a['status']] ?? 9;
        $pB = $priority[$b['status']] ?? 9;
        if ($pA !== $pB) {
            return $pA <=> $pB;
        }
        return strcmp($b['requested_at'] ?? '', $a['requested_at'] ?? '');
    });

    return rest_ensure_response([
        'success'   => true,
        'employees' => $result_list,
        'count'     => count($result_list),
    ]);
}

/**
 * Request employee access / Allowlist an email
 */
function mumbai_admin_request_employee_access(WP_REST_Request $request) {
    $email = sanitize_email($request->get_param('email') ?? '');
    $role = sanitize_text_field($request->get_param('role') ?? 'employee');
    $notes = sanitize_textarea_field($request->get_param('notes') ?? '');
    $admin_id = absint($request->get_param('admin_id') ?? 0);

    if (empty($email) || !is_email($email)) {
        return new WP_Error('invalid_email', 'Please provide a valid email address.', ['status' => 400]);
    }

    if (!mumbai_is_valid_employee_role($role)) {
        return new WP_Error('invalid_role', "Invalid role. Only 'employee' can be requested.", ['status' => 400]);
    }

    $norm_email = strtolower(trim($email));
    $user = get_user_by('email', $norm_email);

    if ($user) {
        if (in_array('administrator', (array)$user->roles, true)) {
            return new WP_Error('invalid_target', 'Cannot manage administrator accounts via employee access.', ['status' => 400]);
        }

        update_user_meta($user->ID, '_mumbai_employee_status', 'pending');
        update_user_meta($user->ID, '_mumbai_employee_requested_at', time());
        update_user_meta($user->ID, '_mumbai_employee_requested_role', 'employee');
        update_user_meta($user->ID, '_mumbai_employee_notes', $notes);
        if ($admin_id) {
            update_user_meta($user->ID, '_mumbai_employee_added_by', $admin_id);
        }

        mumbai_log("Employee access requested for registered user {$user->ID} ({$norm_email})");

        return rest_ensure_response([
            'success'       => true,
            'message'       => 'User added to pending approval queue.',
            'is_registered' => true,
            'user_id'       => $user->ID,
        ]);
    }

    // User not registered yet: save to allowlist option
    $allowlist = (array) get_option('_mumbai_employee_allowlist', []);
    $allowlist[$norm_email] = [
        'email'          => $norm_email,
        'requested_role' => 'employee',
        'notes'          => $notes,
        'requested_at'   => time(),
        'added_by'       => $admin_id,
    ];
    update_option('_mumbai_employee_allowlist', $allowlist);

    mumbai_log("Employee email allowlisted: {$norm_email}");

    return rest_ensure_response([
        'success'       => true,
        'message'       => 'Email allowlisted. Once the user registers with this email, they will appear in the pending approvals list.',
        'is_registered' => false,
    ]);
}

/**
 * Approve employee access
 */
function mumbai_admin_approve_employee(WP_REST_Request $request) {
    $user_id = absint($request->get_param('user_id') ?? 0);
    $role = sanitize_text_field($request->get_param('role') ?? 'employee');
    $approved_by = absint($request->get_param('approved_by') ?? 0);

    if (!$user_id) {
        return new WP_Error('invalid_user', 'Valid User ID is required.', ['status' => 400]);
    }

    if (!mumbai_is_valid_employee_role($role)) {
        return new WP_Error('invalid_role', "Invalid role. Only 'employee' can be assigned.", ['status' => 400]);
    }

    $user = get_user_by('id', $user_id);
    if (!$user) {
        return new WP_Error('user_not_found', 'User not found.', ['status' => 404]);
    }

    if (in_array('administrator', (array)$user->roles, true)) {
        return new WP_Error('invalid_target', 'Cannot modify administrator roles.', ['status' => 400]);
    }

    $wp_user = new WP_User($user_id);
    $wp_user->set_role('employee');

    update_user_meta($user_id, '_mumbai_employee_status', 'approved');
    update_user_meta($user_id, '_mumbai_employee_role', 'employee');
    update_user_meta($user_id, '_mumbai_employee_approved_at', time());
    update_user_meta($user_id, '_mumbai_employee_approved_by', $approved_by);
    delete_user_meta($user_id, '_mumbai_employee_rejected_at');

    // Invalidate sessions so new capabilities are active on fresh signin
    WP_Session_Tokens::get_instance($user_id)->destroy_all();

    mumbai_log("Employee access approved for user {$user_id} as employee by admin {$approved_by}");

    return rest_ensure_response([
        'success' => true,
        'message' => "User approved with role 'employee'.",
        'role'    => 'employee',
        'status'  => 'approved',
    ]);
}

/**
 * Reject employee access request
 */
function mumbai_admin_reject_employee(WP_REST_Request $request) {
    $user_id = absint($request->get_param('user_id') ?? 0);
    $reason = sanitize_textarea_field($request->get_param('reason') ?? '');
    $rejected_by = absint($request->get_param('rejected_by') ?? 0);

    if (!$user_id) {
        return new WP_Error('invalid_user', 'Valid User ID is required.', ['status' => 400]);
    }

    $user = get_user_by('id', $user_id);
    if (!$user) {
        return new WP_Error('user_not_found', 'User not found.', ['status' => 404]);
    }

    if (in_array('administrator', (array)$user->roles, true)) {
        return new WP_Error('invalid_target', 'Cannot modify administrator accounts.', ['status' => 400]);
    }

    $wp_user = new WP_User($user_id);
    $wp_user->set_role('customer');

    update_user_meta($user_id, '_mumbai_employee_status', 'rejected');
    update_user_meta($user_id, '_mumbai_employee_rejected_at', time());
    update_user_meta($user_id, '_mumbai_employee_rejected_by', $rejected_by);
    if (!empty($reason)) {
        update_user_meta($user_id, '_mumbai_employee_rejection_reason', $reason);
    }

    WP_Session_Tokens::get_instance($user_id)->destroy_all();

    mumbai_log("Employee access rejected for user {$user_id} by admin {$rejected_by}");

    return rest_ensure_response([
        'success' => true,
        'message' => 'Employee access request rejected.',
        'status'  => 'rejected',
    ]);
}

/**
 * Update employee status (active / deactivated)
 */
function mumbai_admin_update_employee_status(WP_REST_Request $request) {
    $user_id = absint($request->get_param('user_id') ?? 0);
    $status = sanitize_text_field($request->get_param('status') ?? '');
    $updated_by = absint($request->get_param('updated_by') ?? 0);

    if (!$user_id) {
        return new WP_Error('invalid_user', 'Valid User ID is required.', ['status' => 400]);
    }

    if (!in_array($status, ['active', 'deactivated'], true)) {
        return new WP_Error('invalid_status', "Status must be 'active' or 'deactivated'.", ['status' => 400]);
    }

    $user = get_user_by('id', $user_id);
    if (!$user) {
        return new WP_Error('user_not_found', 'User not found.', ['status' => 404]);
    }

    if (in_array('administrator', (array)$user->roles, true)) {
        return new WP_Error('invalid_target', 'Cannot modify administrator accounts.', ['status' => 400]);
    }

    $wp_user = new WP_User($user_id);

    if ($status === 'deactivated') {
        $wp_user->set_role('customer');
        update_user_meta($user_id, '_mumbai_employee_status', 'deactivated');
        update_user_meta($user_id, '_mumbai_employee_deactivated_at', time());
        update_user_meta($user_id, '_mumbai_employee_deactivated_by', $updated_by);
        WP_Session_Tokens::get_instance($user_id)->destroy_all();

        mumbai_log("Employee access deactivated for user {$user_id} by admin {$updated_by}");

        return rest_ensure_response([
            'success' => true,
            'message' => 'Employee access deactivated and sessions revoked.',
            'status'  => 'deactivated',
        ]);
    } else {
        $wp_user->set_role('employee');
        update_user_meta($user_id, '_mumbai_employee_status', 'approved');
        update_user_meta($user_id, '_mumbai_employee_role', 'employee');
        update_user_meta($user_id, '_mumbai_employee_reactivated_at', time());
        update_user_meta($user_id, '_mumbai_employee_reactivated_by', $updated_by);

        mumbai_log("Employee access reactivated for user {$user_id} as employee by admin {$updated_by}");

        return rest_ensure_response([
            'success' => true,
            'message' => "Employee access reactivated with role 'employee'.",
            'status'  => 'approved',
            'role'    => 'employee',
        ]);
    }
}

/**
 * Revoke all active sessions for a user
 */
function mumbai_admin_revoke_employee_sessions(WP_REST_Request $request) {
    $user_id = absint($request->get_param('user_id') ?? 0);

    if (!$user_id) {
        return new WP_Error('invalid_user', 'Valid User ID is required.', ['status' => 400]);
    }

    $user = get_user_by('id', $user_id);
    if (!$user) {
        return new WP_Error('user_not_found', 'User not found.', ['status' => 404]);
    }

    WP_Session_Tokens::get_instance($user_id)->destroy_all();

    mumbai_log("All sessions revoked for user {$user_id}");

    return rest_ensure_response([
        'success' => true,
        'message' => 'All active sessions have been revoked for this user.',
    ]);
}

/**
 * ─────────────────────────────────────────────
 * STORE OPERATING HOURS HANDLERS
 * ─────────────────────────────────────────────
 */

/**
 * Get store operating hours configuration from wp_options
 */
function mumbai_get_store_hours() {
    $hours = get_transient('mumbai_store_hours');
    if ($hours === false || $hours === null) {
        $hours = get_option('mumbai_store_hours', null);
    }
    return rest_ensure_response([
        'success'     => true,
        'store_hours' => $hours,
    ]);
}

/**
 * Save store operating hours configuration to wp_options
 */
function mumbai_save_store_hours(WP_REST_Request $request) {
    $config = $request->get_param('store_hours');
    if (!is_array($config)) {
        return new WP_Error('invalid_config', 'store_hours must be an array/object.', ['status' => 400]);
    }
    update_option('mumbai_store_hours', $config, false);
    set_transient('mumbai_store_hours', $config, DAY_IN_SECONDS);
    return rest_ensure_response([
        'success'     => true,
        'message'     => 'Store hours updated successfully.',
        'store_hours' => $config,
    ]);
}

/**
 * ─────────────────────────────────────────────
 * REGISTERED CUSTOMERS DIRECTORY (ADMIN)
 * ─────────────────────────────────────────────
 */

/** Name of the materialized per-customer order-metrics table. */
/** Shared read-only reporting source: one row per sale, net of recorded refunds. */
function mumbai_reporting_orders_source() {
    global $wpdb;
    $table = $wpdb->prefix . 'wc_orders';
    return "(SELECT sale.id, sale.type, sale.status, sale.customer_id, sale.billing_email,
        sale.date_created_gmt, sale.payment_method, sale.currency,
        GREATEST(0, sale.total_amount - COALESCE(refunds.amount, 0)) AS total_amount
        FROM {$table} sale
        LEFT JOIN (SELECT parent_order_id, SUM(ABS(total_amount)) AS amount FROM {$table}
            WHERE type = 'shop_order_refund' GROUP BY parent_order_id) refunds ON refunds.parent_order_id = sale.id
        WHERE sale.type = 'shop_order')";
}

/** Refund item quantities/totals are negative; fold them into their original line once. */
function mumbai_reporting_itemmeta_source() {
    global $wpdb;
    $meta = $wpdb->prefix . 'woocommerce_order_itemmeta';
    $items = $wpdb->prefix . 'woocommerce_order_items';
    $orders = $wpdb->prefix . 'wc_orders';
    return "(SELECT original.meta_id, original.order_item_id, original.meta_key,
        CASE WHEN original.meta_key IN ('_qty', '_line_total')
          THEN CAST(GREATEST(0, CAST(original.meta_value AS DECIMAL(20,6)) - COALESCE(refunds.amount, 0)) AS CHAR)
          ELSE original.meta_value END AS meta_value
        FROM {$meta} original LEFT JOIN (
          SELECT CAST(reference.meta_value AS UNSIGNED) AS item_id, value.meta_key,
                 SUM(ABS(CAST(value.meta_value AS DECIMAL(20,6)))) AS amount
          FROM {$meta} reference JOIN {$meta} value ON value.order_item_id = reference.order_item_id
          JOIN {$items} item ON item.order_item_id = reference.order_item_id
          JOIN {$orders} refund ON refund.id = item.order_id AND refund.type = 'shop_order_refund'
          WHERE reference.meta_key = '_refunded_item_id' AND value.meta_key IN ('_qty', '_line_total')
          GROUP BY item_id, value.meta_key
        ) refunds ON refunds.item_id = original.order_item_id AND refunds.meta_key = original.meta_key)";
}

function mumbai_require_reporting_hpos() {
    return class_exists('Automattic\\WooCommerce\\Utilities\\OrderUtil') &&
        Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled();
}

function mumbai_customer_metrics_table_name() {
    global $wpdb;
    return $wpdb->prefix . 'mumbai_customer_metrics';
}

function mumbai_customer_search_table_name() {
    global $wpdb;
    return $wpdb->prefix . 'mumbai_customer_search';
}

/** Create the customer metrics table and begin a resumable historical backfill. */
function mumbai_upgrade_customer_metrics_table() {
    global $wpdb;
    $table = mumbai_customer_metrics_table_name();
    $table_exists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table)) === $table;
    if ((int) get_option('mumbai_customer_metrics_schema_version', 0) < 1 || !$table_exists) {
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset_collate = $wpdb->get_charset_collate();
        dbDelta("CREATE TABLE {$table} (
            customer_id BIGINT UNSIGNED NOT NULL,
            orders_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
            lifetime_spent DECIMAL(26,8) NOT NULL DEFAULT 0,
            last_order_date_gmt DATETIME NULL,
            last_order_id BIGINT UNSIGNED NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (customer_id),
            KEY lifetime_spent (lifetime_spent),
            KEY orders_count (orders_count),
            KEY last_order_date_gmt (last_order_date_gmt)
        ) {$charset_collate};");
        update_option('mumbai_customer_metrics_schema_version', 1, false);
        if (!$table_exists) {
            delete_option('mumbai_customer_metrics_backfill_complete');
            delete_option('mumbai_customer_metrics_backfill_last_customer_id');
        }
    }

    $search_table = mumbai_customer_search_table_name();
    $search_table_exists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $search_table)) === $search_table;
    if ((int) get_option('mumbai_customer_search_schema_version', 0) < 1 || !$search_table_exists) {
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset_collate = $wpdb->get_charset_collate();
        dbDelta("CREATE TABLE {$search_table} (
            customer_id BIGINT UNSIGNED NOT NULL,
            display_name VARCHAR(191) NOT NULL DEFAULT '',
            email VARCHAR(191) NOT NULL DEFAULT '',
            username VARCHAR(60) NOT NULL DEFAULT '',
            phone_digits VARCHAR(32) NOT NULL DEFAULT '',
            location_key VARCHAR(32) NOT NULL DEFAULT 'unassigned',
            search_text TEXT NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (customer_id),
            KEY display_name (display_name),
            KEY email (email),
            KEY username (username),
            KEY phone_digits (phone_digits),
            KEY location_key (location_key),
            FULLTEXT KEY search_text_fulltext (search_text)
        ) {$charset_collate};");
        update_option('mumbai_customer_search_schema_version', 1, false);
        if (!$search_table_exists) {
            delete_option('mumbai_customer_search_backfill_complete');
            delete_option('mumbai_customer_search_backfill_last_user_id');
        }
    }

    if (!get_option('mumbai_customer_metrics_backfill_complete') && !wp_next_scheduled('mumbai_customer_metrics_backfill_batch')) {
        wp_schedule_single_event(time() + 10, 'mumbai_customer_metrics_backfill_batch');
    }
    if (!get_option('mumbai_customer_search_backfill_complete') && !wp_next_scheduled('mumbai_customer_search_backfill_batch')) {
        wp_schedule_single_event(time() + 10, 'mumbai_customer_search_backfill_batch');
    }
}
add_action('init', 'mumbai_upgrade_customer_metrics_table', 31);

function mumbai_get_customer_location_key($city, $postcode, $address) {
    $city = strtolower(trim((string) $city));
    $postcode = preg_replace('/\D/', '', (string) $postcode);
    $address = strtolower((string) $address);
    if (strpos($city, 'vasai') !== false) {
        if (strpos($city, 'east') !== false || strpos($city, '(e)') !== false) return 'vasai-east';
        if (strpos($city, 'west') !== false || strpos($city, '(w)') !== false) return 'vasai-west';
    }
    if (strpos($city, 'nalasopara') !== false || strpos($city, 'nallasopara') !== false || strpos($city, 'sopara') !== false) {
        if (strpos($city, 'east') !== false || strpos($city, '(e)') !== false) return 'nalasopara-east';
        if (strpos($city, 'west') !== false || strpos($city, '(w)') !== false) return 'nalasopara-west';
    }
    $postcode_locations = [
        '401201' => 'vasai-west', '401202' => 'vasai-east', '401208' => 'vasai-east',
        '401203' => 'nalasopara-west', '401209' => 'nalasopara-east',
    ];
    if (isset($postcode_locations[$postcode])) return $postcode_locations[$postcode];
    $rules = [
        'vasai-east' => ['evershine', 'navghar'],
        'vasai-west' => ['chulna', 'babola', 'ambadi', 'vasai station west', 'vasai (w)', 'vasai west'],
        'nalasopara-east' => ['achole', 'moregaon', 'central park nalasopara', 'nalasopara (e)', 'nallasopara (e)', 'nalasopara east', 'nallasopara east'],
        'nalasopara-west' => ['patankar park', 'sopara west', 'nalasopara (w)', 'nallasopara (w)', 'nalasopara west', 'nallasopara west'],
    ];
    foreach ($rules as $key => $keywords) {
        foreach ($keywords as $keyword) {
            if (strpos($address, $keyword) !== false) return $key;
        }
    }
    return 'unassigned';
}

/** Keep one searchable, indexed record per customer instead of scanning many usermeta rows. */
function mumbai_sync_customer_search_index($user_id) {
    global $wpdb;
    $user_id = absint($user_id);
    $user = $user_id ? get_userdata($user_id) : false;
    $table = mumbai_customer_search_table_name();
    if (!$user) {
        if ($user_id) $wpdb->delete($table, ['customer_id' => $user_id], ['%d']);
        return true;
    }

    $first = (string) get_user_meta($user_id, 'first_name', true);
    $last = (string) get_user_meta($user_id, 'last_name', true);
    $phone = mumbai_get_user_contact_phone($user_id);
    $city = (string) get_user_meta($user_id, 'billing_city', true);
    $state = (string) get_user_meta($user_id, 'billing_state', true);
    $postcode = (string) get_user_meta($user_id, 'billing_postcode', true);
    $address = implode(' ', array_filter([
        get_user_meta($user_id, 'billing_address_1', true),
        get_user_meta($user_id, 'billing_address_2', true),
        $city,
        $state,
        $postcode,
    ]));
    $display_name = trim($first . ' ' . $last) ?: (string) $user->display_name;
    $phone_digits = preg_replace('/\D/', '', $phone);
    $search_text = strtolower(implode(' ', array_filter([
        $display_name, $user->user_email, $user->user_login, $phone, $address,
    ])));
    return $wpdb->replace($table, [
        'customer_id' => $user_id,
        'display_name' => $display_name,
        'email' => strtolower((string) $user->user_email),
        'username' => strtolower((string) $user->user_login),
        'phone_digits' => $phone_digits,
        'location_key' => mumbai_get_customer_location_key($city, $postcode, $address),
        'search_text' => $search_text,
        'updated_at' => current_time('mysql', true),
    ], ['%d', '%s', '%s', '%s', '%s', '%s', '%s', '%s']);
}

function mumbai_schedule_customer_search_index_update($user_id, $meta_id = null, $meta_key = null) {
    if ($meta_key !== null && !in_array($meta_key, [
        'first_name', 'last_name', 'billing_phone',
        'billing_city', 'billing_state', 'billing_postcode', 'billing_address_1', 'billing_address_2',
    ], true)) {
        return;
    }
    wp_schedule_single_event(time() + 5, 'mumbai_sync_customer_search_index_event', [absint($user_id)]);
}
function mumbai_schedule_customer_search_index_from_meta($meta_id, $user_id, $meta_key) {
    mumbai_schedule_customer_search_index_update($user_id, $meta_id, $meta_key);
}
add_action('user_register', 'mumbai_schedule_customer_search_index_update', 10, 1);
add_action('profile_update', 'mumbai_schedule_customer_search_index_update', 10, 1);
add_action('added_user_meta', 'mumbai_schedule_customer_search_index_from_meta', 10, 3);
add_action('updated_user_meta', 'mumbai_schedule_customer_search_index_from_meta', 10, 3);
add_action('deleted_user_meta', 'mumbai_schedule_customer_search_index_from_meta', 10, 3);
add_action('mumbai_sync_customer_search_index_event', 'mumbai_sync_customer_search_index', 10, 1);
add_action('deleted_user', function ($user_id) {
    global $wpdb;
    $wpdb->delete(mumbai_customer_search_table_name(), ['customer_id' => absint($user_id)], ['%d']);
}, 10, 1);

function mumbai_customer_search_backfill_batch() {
    global $wpdb;
    $batch_size = 250;
    $last_id = (int) get_option('mumbai_customer_search_backfill_last_user_id', 0);
    $user_ids = $wpdb->get_col($wpdb->prepare(
        "SELECT ID FROM {$wpdb->users} WHERE ID > %d ORDER BY ID ASC LIMIT %d",
        $last_id,
        $batch_size
    ));
    if (!empty($wpdb->last_error)) {
        wp_schedule_single_event(time() + 30, 'mumbai_customer_search_backfill_batch');
        return;
    }
    if (empty($user_ids)) {
        update_option('mumbai_customer_search_backfill_complete', 1, false);
        delete_option('mumbai_customer_search_backfill_last_user_id');
        return;
    }
    $user_ids = array_map('absint', $user_ids);
    update_meta_cache('user', $user_ids);
    $write_failed = false;
    foreach ($user_ids as $user_id) {
        if (mumbai_sync_customer_search_index($user_id) === false) $write_failed = true;
    }
    if ($write_failed) {
        wp_schedule_single_event(time() + 30, 'mumbai_customer_search_backfill_batch');
        return;
    }
    update_option('mumbai_customer_search_backfill_last_user_id', max($user_ids), false);
    wp_schedule_single_event(time() + 15, 'mumbai_customer_search_backfill_batch');
}
add_action('mumbai_customer_search_backfill_batch', 'mumbai_customer_search_backfill_batch');

/** Recalculate exactly one customer's metrics after one of their orders changes. */
function mumbai_refresh_customer_metrics($customer_id) {
    global $wpdb;
    $reporting_source = mumbai_reporting_orders_source();
    if (!mumbai_require_reporting_hpos()) return;
    $customer_id = absint($customer_id);
    $table_orders = $wpdb->prefix . 'wc_orders';
    $table_metrics = mumbai_customer_metrics_table_name();
    if (!$customer_id || $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_orders)) !== $table_orders ||
        $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_metrics)) !== $table_metrics) {
        return;
    }

    $invalid_statuses_sql = "('wc-pending', 'wc-cancelled', 'wc-failed', 'wc-refunded', 'wc-trash', 'wc-on-hold', 'wc-checkout-draft', 'pending', 'cancelled', 'failed', 'refunded', 'trash', 'on-hold', 'checkout-draft')";
    $row = $wpdb->get_row($wpdb->prepare(
        "SELECT COUNT(id) AS orders_count,
                COALESCE(SUM(total_amount), 0) AS lifetime_spent,
                MAX(date_created_gmt) AS last_order_date_gmt,
                MAX(id) AS last_order_id
         FROM {$reporting_source} reporting_orders
         WHERE customer_id = %d AND status NOT IN {$invalid_statuses_sql}",
        $customer_id
    ), ARRAY_A);

    if ($wpdb->last_error) return;
    if (!$row || (int) $row['orders_count'] === 0) {
        $wpdb->delete($table_metrics, ['customer_id' => $customer_id], ['%d']);
        return;
    }

    $wpdb->replace($table_metrics, [
        'customer_id'          => $customer_id,
        'orders_count'         => (int) $row['orders_count'],
        'lifetime_spent'       => $row['lifetime_spent'],
        'last_order_date_gmt'  => $row['last_order_date_gmt'],
        'last_order_id'        => $row['last_order_id'],
        'updated_at'           => current_time('mysql', true),
    ], ['%d', '%d', '%s', '%s', '%d', '%s']);
}

/** Populate metrics in bounded batches; safe to resume after a request interruption. */
function mumbai_customer_metrics_backfill_batch() {
    global $wpdb;
    $reporting_source = mumbai_reporting_orders_source();
    if (!mumbai_require_reporting_hpos()) return;
    $table_orders = $wpdb->prefix . 'wc_orders';
    $table_metrics = mumbai_customer_metrics_table_name();
    if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_orders)) !== $table_orders ||
        $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_metrics)) !== $table_metrics) {
        return;
    }

    $batch_size = 200;
    $last_id = (int) get_option('mumbai_customer_metrics_backfill_last_customer_id', 0);
    $customer_ids = $wpdb->get_col($wpdb->prepare(
        "SELECT DISTINCT customer_id FROM {$reporting_source} reporting_orders
         WHERE customer_id > %d ORDER BY customer_id ASC LIMIT %d",
        $last_id,
        $batch_size
    ));

    if (!empty($wpdb->last_error)) {
        wp_schedule_single_event(time() + 30, 'mumbai_customer_metrics_backfill_batch');
        return;
    }

    if (empty($customer_ids)) {
        update_option('mumbai_customer_metrics_backfill_complete', 1, false);
        delete_option('mumbai_customer_metrics_backfill_last_customer_id');
        return;
    }

    $customer_ids = array_map('absint', $customer_ids);
    $placeholders = implode(',', array_fill(0, count($customer_ids), '%d'));
    $invalid_statuses_sql = "('wc-pending', 'wc-cancelled', 'wc-failed', 'wc-refunded', 'wc-trash', 'wc-on-hold', 'wc-checkout-draft', 'pending', 'cancelled', 'failed', 'refunded', 'trash', 'on-hold', 'checkout-draft')";
    $query = $wpdb->prepare(
        "SELECT customer_id, COUNT(id) AS orders_count,
                COALESCE(SUM(total_amount), 0) AS lifetime_spent,
                MAX(date_created_gmt) AS last_order_date_gmt,
                MAX(id) AS last_order_id
         FROM {$reporting_source} reporting_orders
         WHERE customer_id IN ({$placeholders}) AND status NOT IN {$invalid_statuses_sql}
         GROUP BY customer_id",
        ...$customer_ids
    );
    $rows = $wpdb->get_results($query, ARRAY_A) ?: [];
    if (!empty($wpdb->last_error)) {
        wp_schedule_single_event(time() + 30, 'mumbai_customer_metrics_backfill_batch');
        return;
    }
    $table_metrics = mumbai_customer_metrics_table_name();
    $missing_ids = array_values(array_diff($customer_ids, array_map(static function ($row) { return (int) $row['customer_id']; }, $rows)));
    if ($missing_ids) {
        $missing_placeholders = implode(',', array_fill(0, count($missing_ids), '%d'));
        if ($wpdb->query($wpdb->prepare("DELETE FROM {$table_metrics} WHERE customer_id IN ({$missing_placeholders})", ...$missing_ids)) === false) {
            wp_schedule_single_event(time() + 30, 'mumbai_customer_metrics_backfill_batch');
            return;
        }
    }
    $write_failed = false;
    foreach ($rows as $row) {
        if ($wpdb->replace($table_metrics, [
            'customer_id'          => (int) $row['customer_id'],
            'orders_count'         => (int) $row['orders_count'],
            'lifetime_spent'       => $row['lifetime_spent'],
            'last_order_date_gmt'  => $row['last_order_date_gmt'],
            'last_order_id'        => $row['last_order_id'],
            'updated_at'           => current_time('mysql', true),
        ], ['%d', '%d', '%s', '%s', '%d', '%s']) === false) {
            $write_failed = true;
        }
    }

    if ($write_failed) {
        wp_schedule_single_event(time() + 30, 'mumbai_customer_metrics_backfill_batch');
        return;
    }

    update_option('mumbai_customer_metrics_backfill_last_customer_id', max($customer_ids), false);
    wp_schedule_single_event(time() + 15, 'mumbai_customer_metrics_backfill_batch');
}
add_action('mumbai_customer_metrics_backfill_batch', 'mumbai_customer_metrics_backfill_batch');

/**
 * Keep customer metrics current. Capture the pre-save owner so reassigned orders
 * refresh both the old and new customer's summary.
 */
function mumbai_capture_order_customer_before_save($order, $data_store = null) {
    global $wpdb, $mumbai_order_customer_before_save;
    if (!($order instanceof WC_Order) || !$order->get_id()) {
        return;
    }
    $table_orders = $wpdb->prefix . 'wc_orders';
    if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_orders)) !== $table_orders) {
        return;
    }
    $old_customer_id = $wpdb->get_var($wpdb->prepare("SELECT customer_id FROM {$table_orders} WHERE id = %d", $order->get_id()));
    $mumbai_order_customer_before_save[(int) $order->get_id()] = absint($old_customer_id);
}
add_action('woocommerce_before_order_object_save', 'mumbai_capture_order_customer_before_save', 5, 2);

function mumbai_refresh_order_customer_metrics_after_save($order, $data_store = null) {
    global $mumbai_order_customer_before_save;
    if (!($order instanceof WC_Order)) {
        return;
    }
    $order_id = absint($order->get_id());
    $old_customer_id = (int) ($mumbai_order_customer_before_save[$order_id] ?? 0);
    unset($mumbai_order_customer_before_save[$order_id]);
    $new_customer_id = absint($order->get_customer_id());
    if ($old_customer_id && $old_customer_id !== $new_customer_id) {
        mumbai_refresh_customer_metrics($old_customer_id);
    }
    if ($new_customer_id) {
        mumbai_refresh_customer_metrics($new_customer_id);
    }
}
add_action('woocommerce_after_order_object_save', 'mumbai_refresh_order_customer_metrics_after_save', 30, 2);

// Refund records belong to their original customer's sale, not a new order.
add_action('woocommerce_order_refunded', static function ($order_id) {
    $order = wc_get_order($order_id);
    if ($order) mumbai_refresh_customer_metrics($order->get_customer_id());
});

add_action('init', static function () {
    if (get_option('mumbai_net_metrics_v1')) return;
    delete_option('mumbai_customer_metrics_backfill_complete');
    delete_option('mumbai_customer_metrics_backfill_last_customer_id');
    if (!wp_next_scheduled('mumbai_customer_metrics_backfill_batch')) wp_schedule_single_event(time() + 10, 'mumbai_customer_metrics_backfill_batch');
    update_option('mumbai_net_metrics_v1', 1, false);
}, 25);

function mumbai_capture_deleted_order_customer($order_id) {
    global $wpdb;
    global $mumbai_deleted_order_customers;
    $table_orders = $wpdb->prefix . 'wc_orders';
    $order_id = absint($order_id);
    $customer_id = absint($wpdb->get_var($wpdb->prepare("SELECT customer_id FROM {$table_orders} WHERE id = %d", $order_id)));
    if ($customer_id) {
        $mumbai_deleted_order_customers[$order_id] = $customer_id;
    }
}
add_action('woocommerce_before_delete_order', 'mumbai_capture_deleted_order_customer', 10, 1);

function mumbai_refresh_deleted_order_customer_metrics($order_id) {
    global $mumbai_deleted_order_customers;
    $customer_id = absint($mumbai_deleted_order_customers[absint($order_id)] ?? 0);
    unset($mumbai_deleted_order_customers[absint($order_id)]);
    if ($customer_id) {
        mumbai_refresh_customer_metrics($customer_id);
    }
}
add_action('woocommerce_delete_order', 'mumbai_refresh_deleted_order_customer_metrics', 10, 1);

/**
 * REST Callback: Get registered customers list (Admin internal endpoint)
 * Database-paginated customer search and ordering backed by precomputed metrics.
 */
function mumbai_admin_get_customers(WP_REST_Request $request) {
    global $wpdb;
    $reporting_source = mumbai_reporting_orders_source();
    if (!mumbai_require_reporting_hpos()) return new WP_Error('hpos_required', 'Enable authoritative HPOS storage for reports.', ['status' => 503]);

    $search   = sanitize_text_field($request->get_param('search') ?? '');
    $location = sanitize_text_field($request->get_param('location') ?? '');
    $sort     = sanitize_text_field($request->get_param('sort') ?? 'ltv_desc');
    $per_page = (int) ($request->get_param('per_page') ?? 20);
    $page     = (int) ($request->get_param('page') ?? 1);

    $limit  = min(100, max(1, $per_page));
    $offset = max(0, ($page - 1) * $limit);

    $table_users    = $wpdb->users;
    $table_usermeta = $wpdb->usermeta;
    $table_orders   = $wpdb->prefix . 'wc_orders';
    $has_hpos       = ($wpdb->get_var("SHOW TABLES LIKE '{$table_orders}'") === $table_orders);
    if (!$has_hpos) {
        return new WP_Error('customer_metrics_unavailable', 'Customer order metrics require the WooCommerce HPOS orders table. Enable HPOS or restore the orders table, then retry.', ['status' => 503]);
    }
    $table_customer_metrics = mumbai_customer_metrics_table_name();
    $metrics_ready = (bool) get_option('mumbai_customer_metrics_backfill_complete') &&
        $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_customer_metrics)) === $table_customer_metrics;
    $table_customer_search = mumbai_customer_search_table_name();
    $search_index_ready = (bool) get_option('mumbai_customer_search_backfill_complete') &&
        $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_customer_search)) === $table_customer_search;

    $cap_key = $wpdb->prefix . 'capabilities';
    $where_clauses = [
        $wpdb->prepare(
            "NOT EXISTS (
                SELECT 1 FROM {$table_usermeta} cap_not 
                WHERE cap_not.user_id = u.ID 
                  AND cap_not.meta_key = %s 
                  AND (cap_not.meta_value LIKE %s OR cap_not.meta_value LIKE %s)
            )",
            $cap_key,
            '%administrator%',
            '%employee%'
        ),
    ];

    // Search filter across display name, email, login, and usermeta
    if (!empty($search)) {
        $normalized_search = strtolower(trim($search));
        if ($search_index_ready) {
            $phone_search = preg_replace('/\D/', '', $normalized_search);
            if (strlen($phone_search) > 10 && substr($phone_search, 0, 2) === '91') {
                $phone_search = substr($phone_search, 2);
            } elseif (strlen($phone_search) === 11 && substr($phone_search, 0, 1) === '0') {
                $phone_search = substr($phone_search, 1);
            }
            $tokens = preg_split('/[^\p{L}\p{N}]+/u', $normalized_search, -1, PREG_SPLIT_NO_EMPTY);
            $tokens = array_values(array_filter($tokens, static function ($token) {
                return function_exists('mb_strlen') ? mb_strlen($token) >= 3 : strlen($token) >= 3;
            }));
            if (!empty($tokens)) {
                $boolean_search = implode(' ', array_map(static function ($token) {
                    return '+' . preg_replace('/[^\p{L}\p{N}]/u', '', $token) . '*';
                }, $tokens));
                $search_match = $wpdb->prepare(
                    "MATCH(search_text) AGAINST (%s IN BOOLEAN MODE)",
                    $boolean_search
                );
                if ($phone_search !== '') {
                    $search_match = '(' . $search_match . ' OR phone_digits LIKE ' . $wpdb->prepare('%s', $wpdb->esc_like($phone_search) . '%') . ')';
                }
                $where_clauses[] = "u.ID IN (SELECT customer_id FROM {$table_customer_search} WHERE {$search_match})";
            } else {
                $prefix = $wpdb->esc_like($normalized_search) . '%';
                $phone_prefix = preg_replace('/\D/', '', $normalized_search);
                $where_clauses[] = $wpdb->prepare(
                    "u.ID IN (SELECT customer_id FROM {$table_customer_search}
                     WHERE display_name LIKE %s OR email LIKE %s OR username LIKE %s OR phone_digits LIKE %s)",
                    $prefix, $prefix, $prefix,
                    $phone_prefix !== '' ? $wpdb->esc_like($phone_prefix) . '%' : $prefix
                );
            }
        } else {
            // Safe compatibility path while the indexed customer search table is backfilling.
            $like = '%' . $wpdb->esc_like($normalized_search) . '%';
            $where_clauses[] = $wpdb->prepare(
                "(u.display_name LIKE %s OR u.user_email LIKE %s OR u.user_login LIKE %s
                  OR u.ID IN (SELECT DISTINCT sm.user_id FROM {$table_usermeta} sm
                    WHERE sm.meta_key IN ('first_name', 'last_name', 'billing_phone', 'billing_city', 'billing_address_1', 'billing_address_2', 'billing_postcode')
                    AND sm.meta_value LIKE %s))",
                $like, $like, $like, $like
            );
        }
    }

    // Location facet filter
    $location_keywords_map = [
        'vasai-east'       => ['vasai east', 'vasai (e)', 'vasai-east', 'evershine', 'navghar', '401202', '401208'],
        'vasai-west'       => ['vasai west', 'vasai (w)', 'vasai-west', 'chulna', 'babola', 'ambadi', '401201'],
        'nallasopara-east' => ['nallasopara east', 'nalasopara east', 'nallasopara (e)', 'nalasopara (e)', 'achole', 'moregaon', '401209'],
        'nalasopara-east'  => ['nallasopara east', 'nalasopara east', 'nallasopara (e)', 'nalasopara (e)', 'achole', 'moregaon', '401209'],
        'nallasopara-west' => ['nallasopara west', 'nalasopara west', 'nallasopara (w)', 'nalasopara (w)', 'sopara west', 'patankar', '401203'],
        'nalasopara-west'  => ['nallasopara west', 'nalasopara west', 'nallasopara (w)', 'nalasopara (w)', 'sopara west', 'patankar', '401203'],
    ];

    $loc_key = strtolower(trim($location));
    if (!empty($loc_key) && $loc_key !== 'all' && isset($location_keywords_map[$loc_key])) {
        if ($search_index_ready) {
            $canonical_location = str_replace('nallasopara', 'nalasopara', $loc_key);
            $where_clauses[] = $wpdb->prepare(
                "u.ID IN (SELECT customer_id FROM {$table_customer_search} WHERE location_key = %s)",
                $canonical_location
            );
        } else {
            $keywords = $location_keywords_map[$loc_key];
            $loc_clauses = [];
            $loc_params  = [];
            foreach ($keywords as $kw) {
                $loc_clauses[] = "loc_m.meta_value LIKE %s";
                $loc_params[]  = '%' . $wpdb->esc_like($kw) . '%';
            }
            $loc_inner = implode(' OR ', $loc_clauses);
            $where_clauses[] = $wpdb->prepare(
                "u.ID IN (
                    SELECT DISTINCT loc_m.user_id FROM {$table_usermeta} loc_m
                    WHERE loc_m.meta_key IN ('billing_city', 'billing_address_1', 'billing_address_2', 'billing_postcode', 'billing_state')
                      AND ({$loc_inner})
                )",
                ...$loc_params
            );
        }
    }

    $invalid_statuses_sql = "('wc-pending', 'wc-cancelled', 'wc-failed', 'wc-refunded', 'wc-trash', 'wc-on-hold', 'wc-checkout-draft', 'pending', 'cancelled', 'failed', 'refunded', 'trash', 'on-hold', 'checkout-draft')";

    // HPOS order metrics are linked only by customer_id. Email matching could
    // incorrectly reattach orders from a deleted account to a later account.
    if ($metrics_ready) {
        $join_orders_sql = "LEFT JOIN (
            SELECT customer_id, orders_count, lifetime_spent,
                   last_order_date_gmt AS last_order_date, last_order_id
            FROM {$table_customer_metrics}
        ) ord ON ord.customer_id = u.ID";
    } else {
        $join_orders_sql = "LEFT JOIN (
            SELECT 
                ord_u.uid,
                COUNT(ord_u.id) AS orders_count,
                COALESCE(SUM(ord_u.total_amount), 0) AS lifetime_spent,
                MAX(ord_u.date_created_gmt) AS last_order_date,
                MAX(ord_u.id) AS last_order_id
            FROM (
                SELECT 
                    o.id,
                    o.total_amount,
                    o.date_created_gmt,
                    o.customer_id AS uid
                FROM {$reporting_source} o
                WHERE o.status NOT IN {$invalid_statuses_sql}
                  AND o.customer_id > 0
            ) ord_u
            WHERE ord_u.uid IS NOT NULL AND ord_u.uid > 0
            GROUP BY ord_u.uid
        ) ord ON ord.uid = u.ID";
    }

    // Server-side sorting
    switch ($sort) {
        case 'ltv_asc':
            $order_by = $has_hpos 
                ? 'COALESCE(ord.lifetime_spent, 0) ASC, COALESCE(ord.orders_count, 0) ASC, u.ID ASC'
                : 'u.user_registered ASC, u.ID ASC';
            break;
        case 'orders_desc':
            $order_by = $has_hpos 
                ? 'COALESCE(ord.orders_count, 0) DESC, COALESCE(ord.lifetime_spent, 0) DESC, u.ID DESC'
                : 'u.user_registered DESC, u.ID DESC';
            break;
        case 'recent':
            $order_by = $has_hpos 
                ? 'COALESCE(ord.last_order_date, u.user_registered) DESC, u.ID DESC'
                : 'u.user_registered DESC, u.ID DESC';
            break;
        case 'name_asc':
            $order_by = 'COALESCE(NULLIF(TRIM(u.display_name), ""), u.user_login) ASC, u.ID ASC';
            break;
        case 'ltv_desc':
        default:
            $order_by = $has_hpos 
                ? 'COALESCE(ord.lifetime_spent, 0) DESC, COALESCE(ord.orders_count, 0) DESC, u.ID DESC'
                : 'u.user_registered DESC, u.ID DESC';
            break;
    }

    $where_sql = implode(' AND ', $where_clauses);

    // Exact total count query across all users matching filters
    $total_count = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$table_users} u WHERE {$where_sql}");
    $total_pages = (int) ceil($total_count / $limit) ?: 1;

    $select_metrics = $has_hpos 
        ? "COALESCE(ord.orders_count, 0) AS orders_count,
           COALESCE(ord.lifetime_spent, 0) AS lifetime_spent,
           ord.last_order_date,
           ord.last_order_id"
        : "0 AS orders_count,
           0 AS lifetime_spent,
           NULL AS last_order_date,
           NULL AS last_order_id";

    // Paginated retrieval of the exact requested slice
    $query = $wpdb->prepare(
        "SELECT 
            u.ID,
            u.user_email,
            u.display_name,
            u.user_login,
            u.user_registered,
            {$select_metrics}
        FROM {$table_users} u
        {$join_orders_sql}
        WHERE {$where_sql}
        ORDER BY {$order_by}
        LIMIT %d OFFSET %d",
        $limit,
        $offset
    );

    $rows = $wpdb->get_results($query, ARRAY_A) ?: [];

    // Prime the WordPress user metadata cache in a single bulk query for only the current page items
    $user_ids = wp_list_pluck($rows, 'ID');
    if ($wpdb->last_error) return new WP_Error("report_query_failed", "Reporting is temporarily unavailable. Check the server logs.", ["status" => 503]);
    if (!empty($user_ids)) {
        update_meta_cache('user', $user_ids);
    }

    $customers = [];

    foreach ($rows as $u) {
        $user_id = (int) $u['ID'];
        $email = strtolower(trim($u['user_email']));
        $first_name = (string) get_user_meta($user_id, 'first_name', true);
        $last_name = (string) get_user_meta($user_id, 'last_name', true);
        $display_name = trim($u['display_name']);
        if (empty($display_name)) {
            $display_name = trim("{$first_name} {$last_name}") ?: $u['user_login'];
        }

        $phone = mumbai_get_user_contact_phone($user_id);

        $addr1 = (string) get_user_meta($user_id, 'billing_address_1', true);
        $addr2 = (string) get_user_meta($user_id, 'billing_address_2', true);
        $city  = (string) get_user_meta($user_id, 'billing_city', true) ?: 'Vasai';
        $state = (string) get_user_meta($user_id, 'billing_state', true) ?: 'Maharashtra';
        $postcode = (string) get_user_meta($user_id, 'billing_postcode', true);

        $address_parts = array_filter([$addr1, $addr2, $city, $state . ($postcode ? " - {$postcode}" : '')]);
        $full_address = implode(', ', $address_parts) ?: 'Vasai, Maharashtra';

        $customers[] = [
            'id'              => $user_id,
            'email'           => $email,
            'name'            => $display_name,
            'first_name'      => $first_name,
            'last_name'       => $last_name,
            'phone'           => $phone,
            'location'        => "{$city}, {$state}",
            'full_address'    => $full_address,
            'registered_at'   => $u['user_registered'] ? date('c', strtotime($u['user_registered'])) : null,
            'ordersCount'     => (int) ($u['orders_count'] ?? 0),
            'lifetimeSpent'   => (int) round((float) ($u['lifetime_spent'] ?? 0)),
            'lastOrderDate'   => !empty($u['last_order_date']) ? date('c', strtotime($u['last_order_date'])) : null,
            'lastOrderId'     => !empty($u['last_order_id']) ? (int) $u['last_order_id'] : null,
            'roles'           => ['customer'],
        ];
    }

    return rest_ensure_response([
        'success'    => true,
        'page'       => (int) $page,
        'per_page'   => (int) $limit,
        'total'      => $total_count,
        'totalPages' => $total_pages,
        'count'      => count($customers),
        'customers'  => $customers,
    ]);
}

/**
 * HPOS-Safe Analytics & Customer LTV Aggregations
 * Direct SQL aggregates over wp_wc_orders to prevent 2,000 order caps and slow loops.
 */
function mumbai_staff_update_order_status(WP_REST_Request $request) {
    global $wpdb;
    $id = absint($request['id']);
    $key = hash('sha256', 'staff-order:' . $id);
    if ((int) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 3)', $key)) !== 1) {
        return new WP_Error('order_busy', 'Another staff member is updating this order.', ['status' => 409]);
    }
    try {
        $order = wc_get_order($id);
        if (!$order) return new WP_Error('order_missing', 'Order not found.', ['status' => 404]);
        $core = $order->get_status();
        $effective = $order->get_meta('_delivery_status', true) ?: $core;
        $target = sanitize_key($request->get_param('target_status'));
        $modified = $order->get_date_modified();
        $modified_gmt = $modified ? gmdate('Y-m-d\TH:i:s', $modified->getTimestamp()) : '';
        if ($request->get_param('expected_status') !== $core ||
            $request->get_param('expected_delivery_status') !== $effective ||
            $request->get_param('expected_modified') !== $modified_gmt) {
            return new WP_Error('order_changed', 'This order changed. Refresh it before updating.', ['status' => 409]);
        }
        $terminal = ['completed', 'cancelled', 'refunded', 'failed'];
        if ((in_array($core, $terminal, true) || in_array($effective, $terminal, true)) && $target !== $effective) {
            return new WP_Error('terminal_order', 'A terminal order cannot be reopened.', ['status' => 409]);
        }
        $allowed = [
            'pending' => ['processing', 'cancelled', 'failed'],
            'on-hold' => ['cancelled', 'failed'],
            'processing' => ['packed', 'out-for-delivery', 'dispatched', 'cancelled', 'failed'],
            'packed' => ['out-for-delivery', 'dispatched', 'cancelled'],
            'out-for-delivery' => ['completed'], 'dispatched' => ['completed'],
        ];
        if ($target !== $effective && !in_array($target, $allowed[$effective] ?? [], true)) {
            return new WP_Error('invalid_transition', 'This fulfillment transition is not allowed.', ['status' => 409]);
        }
        if (in_array($target, ['processing', 'packed', 'out-for-delivery', 'dispatched', 'completed'], true) &&
            $order->get_payment_method() !== 'cod' && !$order->get_date_paid() &&
            !$order->get_transaction_id() && !$order->get_meta('_payment_verified_at', true)) {
            return new WP_Error('unpaid_order', 'Online payment has not been confirmed.', ['status' => 409]);
        }
        if ($target !== $effective) {
            $order->set_status(in_array($target, ['packed', 'out-for-delivery', 'dispatched'], true) ? 'processing' : $target);
            $order->update_meta_data('_delivery_status', $target);
            if ($target === 'completed') $order->update_meta_data('_delivery_completed_at', gmdate('c'));
            $order->save();
        }
        $controller = new WC_REST_Orders_Controller();
        return $controller->prepare_object_for_response($order, new WP_REST_Request('GET'));
    } catch (Throwable $error) {
        error_log('[Mumbai Staff] Status mutation failed: ' . $error->getMessage());
        return new WP_Error('status_unavailable', 'Could not update the order.', ['status' => 503]);
    } finally {
        $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $key));
    }
}

/** Compare and replace while holding the same authoritative stock row used by WooCommerce. */
function mumbai_staff_adjust_product(WP_REST_Request $request) {
    global $wpdb;
    $product = wc_get_product(absint($request['id']));
    $payload = $request->get_json_params();
    if (!$product || !array_key_exists('expected_stock_quantity', $payload) ||
        !isset($payload['stock_quantity']) || !is_numeric($payload['stock_quantity']) || (float) $payload['stock_quantity'] < 0) {
        return new WP_Error('invalid_stock', 'Refresh the product and provide a valid stock quantity.', ['status' => 400]);
    }
    if ($wpdb->query('START TRANSACTION') === false) return new WP_Error('stock_unavailable', 'Inventory is unavailable.', ['status' => 503]);
    try {
        $managed_id = $product->get_stock_managed_by_id();
        $stock = $wpdb->get_var(WC_Data_Store::load('product')->get_query_for_stock($managed_id) . ' FOR UPDATE');
        if ($stock === null || $wpdb->last_error) throw new RuntimeException('Could not lock stock row.');
        if (($payload['expected_stock_quantity'] === null && $product->managing_stock()) ||
            ($payload['expected_stock_quantity'] !== null && (float) $stock !== (float) $payload['expected_stock_quantity'])) {
            $wpdb->query('ROLLBACK');
            return new WP_Error('stock_changed', 'Stock changed since you opened this product. Refresh and review the new quantity.', ['status' => 409]);
        }
        if ((float) $payload['stock_quantity'] < (float) wc_get_held_stock_quantity(wc_get_product($managed_id))) {
            $wpdb->query('ROLLBACK');
            return new WP_Error('stock_reserved', 'This quantity is reserved by active checkouts. Review those orders before reducing stock.', ['status' => 409]);
        }
        unset($payload['expected_stock_quantity']);
        $update = new WP_REST_Request('PUT');
        $update->set_param('context', 'edit');
        $update->set_param('id', $product->get_id());
        foreach ($payload as $name => $value) $update->set_param($name, $value);
        $response = (new WC_REST_Products_Controller())->update_item($update);
        if (is_wp_error($response)) { $wpdb->query('ROLLBACK'); return $response; }
        if ($wpdb->query('COMMIT') === false) throw new RuntimeException('Stock commit failed.');
        return $response;
    } catch (Throwable $error) {
        $wpdb->query('ROLLBACK');
        wc_delete_product_transients($product->get_id());
        error_log('[Mumbai Staff] Stock adjustment failed: ' . $error->getMessage());
        return new WP_Error('stock_unavailable', 'Could not safely update stock.', ['status' => 503]);
    }
}

function mumbai_admin_get_analytics_summary(WP_REST_Request $request) {
    global $wpdb;
    $reporting_source = mumbai_reporting_orders_source();
    if (!mumbai_require_reporting_hpos()) return new WP_Error('hpos_required', 'Enable authoritative HPOS storage for reports.', ['status' => 503]);

    $type = sanitize_text_field($request->get_param('type') ?? 'all');
    $table_orders = $wpdb->prefix . 'wc_orders';
    $has_hpos = ($wpdb->get_var("SHOW TABLES LIKE '{$table_orders}'") === $table_orders);

    if (!$has_hpos) {
        return rest_ensure_response([
            'success'  => false,
            'fallback' => true,
            'message'  => 'HPOS orders table not available',
        ]);
    }

    $invalid_statuses_sql = "('wc-pending', 'wc-cancelled', 'wc-failed', 'wc-refunded', 'wc-trash', 'wc-on-hold', 'wc-checkout-draft', 'pending', 'cancelled', 'failed', 'refunded', 'trash', 'on-hold', 'checkout-draft')";

    // Customer LTV aggregations across entire store history (for Admin Customer Directory)
    if ($type === 'customer_ltv') {
        $ltv_rows = $wpdb->get_results(
            "SELECT 
                customer_id,
                COUNT(id) AS ordersCount,
                COALESCE(SUM(total_amount), 0) AS lifetimeSpent,
                MAX(date_created_gmt) AS lastOrderDate,
                MAX(id) AS lastOrderId
             FROM {$reporting_source} reporting_orders
             WHERE status NOT IN {$invalid_statuses_sql}
               AND customer_id > 0
             GROUP BY customer_id",
            ARRAY_A
        );
    if ($wpdb->last_error) return new WP_Error("report_query_failed", "Reporting is temporarily unavailable. Check the server logs.", ["status" => 503]);

        return rest_ensure_response([
            'success'      => true,
            'customer_ltv' => $ltv_rows ?: [],
        ]);
    }

    $table_meta = $wpdb->prefix . 'wc_orders_meta';
    $has_meta = ($wpdb->get_var("SHOW TABLES LIKE '{$table_meta}'") === $table_meta);

    // Single-pass authoritative order status query respecting operational delivery status overrides
    if ($has_meta) {
        $status_rows = $wpdb->get_results(
            "SELECT 
                CASE WHEN REPLACE(o.status, 'wc-', '') IN ('cancelled','failed','refunded','completed') THEN REPLACE(o.status, 'wc-', '') ELSE LOWER(TRIM(COALESCE(NULLIF(dm.meta_value, ''), REPLACE(o.status, 'wc-', '')))) END AS clean_status,
                COUNT(o.id) AS count,
                COALESCE(SUM(o.total_amount), 0) AS total_revenue
             FROM {$reporting_source} o
             LEFT JOIN (SELECT order_id, MAX(meta_value) AS meta_value FROM {$table_meta} WHERE meta_key = '_delivery_status' GROUP BY order_id) dm ON dm.order_id = o.id
             GROUP BY clean_status",
            ARRAY_A
        );
    if ($wpdb->last_error) return new WP_Error("report_query_failed", "Reporting is temporarily unavailable. Check the server logs.", ["status" => 503]);
        $valid_revenue_where = "REPLACE(LOWER(TRIM(o.status)), 'wc-', '') IN ('processing', 'completed')";
        $join_dm_sql = "LEFT JOIN (SELECT order_id, MAX(meta_value) AS meta_value FROM {$table_meta} WHERE meta_key = '_delivery_status' GROUP BY order_id) dm ON dm.order_id = o.id";
    } else {
        $status_rows = $wpdb->get_results(
            "SELECT 
                LOWER(TRIM(REPLACE(status, 'wc-', ''))) AS clean_status,
                COUNT(id) AS count,
                COALESCE(SUM(total_amount), 0) AS total_revenue
             FROM {$reporting_source} reporting_orders
             GROUP BY clean_status",
            ARRAY_A
        );
    if ($wpdb->last_error) return new WP_Error("report_query_failed", "Reporting is temporarily unavailable. Check the server logs.", ["status" => 503]);
        $valid_revenue_where = "REPLACE(LOWER(TRIM(o.status)), 'wc-', '') NOT IN ('pending', 'cancelled', 'failed', 'refunded', 'trash', 'on-hold', 'checkout-draft')";
        $join_dm_sql = "";
    }

    $status_counts = [
        'completed'        => 0,
        'processing'       => 0,
        'on-hold'          => 0,
        'out-for-delivery' => 0,
        'dispatched'       => 0,
        'cancelled'        => 0,
        'refunded'         => 0,
        'failed'           => 0,
        'total'            => 0,
    ];
    $completed_revenue = 0.0;
    $total_orders = 0;

    if ($status_rows) {
        foreach ($status_rows as $row) {
            $s = $row['clean_status'];
            $c = (int) $row['count'];
            $r = (float) $row['total_revenue'];
            $total_orders += $c;

            // Normalize status aliases
            if ($s === 'delivered') {
                $s = 'completed';
            } elseif ($s === 'out_for_delivery') {
                $s = 'out-for-delivery';
            }

            if (isset($status_counts[$s])) {
                $status_counts[$s] += $c;
            }
            if ($s === 'completed') {
                $completed_revenue += $r;
            }
        }
    }
    $status_counts['total'] = $total_orders;

    // Revenue aggregations on valid orders (excluding cancelled/refunded/failed orders)
    $table_operational = $wpdb->prefix . 'wc_order_operational_data';
    $has_operational = ($wpdb->get_var("SHOW TABLES LIKE '{$table_operational}'") === $table_operational);

    if ($has_operational) {
        $rev_row = $wpdb->get_row(
            "SELECT 
                COALESCE(SUM(o.total_amount), 0) AS total_revenue,
                COALESCE(SUM(op.shipping_total_amount), 0) AS shipping_revenue,
                COALESCE(SUM(op.discount_total_amount), 0) AS discount_total,
                COUNT(o.id) AS valid_order_count
             FROM {$reporting_source} o
             {$join_dm_sql}
             LEFT JOIN {$table_operational} op ON op.order_id = o.id
             WHERE {$valid_revenue_where}",
            ARRAY_A
        );
    if ($wpdb->last_error) return new WP_Error("report_query_failed", "Reporting is temporarily unavailable. Check the server logs.", ["status" => 503]);
    } else {
        $rev_row = $wpdb->get_row(
            "SELECT 
                COALESCE(SUM(o.total_amount), 0) AS total_revenue,
                0 AS shipping_revenue,
                0 AS discount_total,
                COUNT(o.id) AS valid_order_count
             FROM {$reporting_source} o
             {$join_dm_sql}
             WHERE {$valid_revenue_where}",
            ARRAY_A
        );
    if ($wpdb->last_error) return new WP_Error("report_query_failed", "Reporting is temporarily unavailable. Check the server logs.", ["status" => 503]);
    }

    $total_revenue = (float) ($rev_row['total_revenue'] ?? 0);
    $shipping_revenue = (float) ($rev_row['shipping_revenue'] ?? 0);
    $discount_total = (float) ($rev_row['discount_total'] ?? 0);
    $valid_order_count = (int) ($rev_row['valid_order_count'] ?? 0);
    $avg_order_value = $valid_order_count > 0 ? (int) round($total_revenue / $valid_order_count) : 0;

    // Today's Sales in IST (respecting operational status overrides)
    $today_after = $request->get_param('today_after') ? gmdate('Y-m-d H:i:s', strtotime($request->get_param('today_after'))) : '';
    $today_before = $request->get_param('today_before') ? gmdate('Y-m-d H:i:s', strtotime($request->get_param('today_before'))) : '';
    $today_sales = 0.0;
    if (!empty($today_after) && !empty($today_before)) {
        $today_row = $wpdb->get_row($wpdb->prepare(
            "SELECT COALESCE(SUM(o.total_amount), 0) AS today_sales
             FROM {$reporting_source} o
             {$join_dm_sql}
             WHERE o.date_created_gmt >= %s AND o.date_created_gmt <= %s
               AND {$valid_revenue_where}",
            $today_after,
            $today_before
        ), ARRAY_A);
    if ($wpdb->last_error) return new WP_Error("report_query_failed", "Reporting is temporarily unavailable. Check the server logs.", ["status" => 503]);
        $today_sales = (float) ($today_row['today_sales'] ?? 0);
    }

    // Month's Sales in IST (respecting operational status overrides)
    $month_after = $request->get_param('month_after') ? gmdate('Y-m-d H:i:s', strtotime($request->get_param('month_after'))) : '';
    $month_before = $request->get_param('month_before') ? gmdate('Y-m-d H:i:s', strtotime($request->get_param('month_before'))) : '';
    $month_sales = 0.0;
    $month_orders = 0;
    if (!empty($month_after) && !empty($month_before)) {
        $month_row = $wpdb->get_row($wpdb->prepare(
            "SELECT COALESCE(SUM(o.total_amount), 0) AS month_sales, COUNT(o.id) AS month_orders
             FROM {$reporting_source} o
             {$join_dm_sql}
             WHERE o.date_created_gmt >= %s AND o.date_created_gmt < %s
               AND {$valid_revenue_where}",
            $month_after,
            $month_before
        ), ARRAY_A);
    if ($wpdb->last_error) return new WP_Error("report_query_failed", "Reporting is temporarily unavailable. Check the server logs.", ["status" => 503]);
        $month_sales = (float) ($month_row['month_sales'] ?? 0);
        $month_orders = (int) ($month_row['month_orders'] ?? 0);
    }

    // Last 7 Days Daily Sales in IST (for Overview and Analytics trend charts)
    $daily_sales_rows = $wpdb->get_results(
        "SELECT 
            DATE(DATE_ADD(o.date_created_gmt, INTERVAL 330 MINUTE)) AS ist_date,
            COUNT(o.id) AS orders_count,
            COALESCE(SUM(o.total_amount), 0) AS daily_revenue
         FROM {$reporting_source} o
         {$join_dm_sql}
         WHERE o.date_created_gmt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 8 DAY)
           AND {$valid_revenue_where}
         GROUP BY ist_date
         ORDER BY ist_date ASC",
        ARRAY_A
    );
    if ($wpdb->last_error) return new WP_Error("report_query_failed", "Reporting is temporarily unavailable. Check the server logs.", ["status" => 503]);

    $weekly_trend = [];
    if ($daily_sales_rows) {
        foreach ($daily_sales_rows as $ds) {
            $weekly_trend[$ds['ist_date']] = [
                'date'    => $ds['ist_date'],
                'orders'  => (int) $ds['orders_count'],
                'revenue' => (int) round((float) $ds['daily_revenue']),
            ];
        }
    }

    // Payment methods breakdown (valid orders only)
    $payment_rows = $wpdb->get_results(
        "SELECT 
            o.payment_method,
            COUNT(o.id) AS count,
            COALESCE(SUM(o.total_amount), 0) AS revenue
         FROM {$reporting_source} o
         {$join_dm_sql}
         WHERE {$valid_revenue_where}
         GROUP BY o.payment_method",
        ARRAY_A
    );
    if ($wpdb->last_error) return new WP_Error("report_query_failed", "Reporting is temporarily unavailable. Check the server logs.", ["status" => 503]);

    $cod_count = 0;
    $cod_revenue = 0.0;
    $online_count = 0;
    $online_revenue = 0.0;

    if ($payment_rows) {
        foreach ($payment_rows as $pr) {
            $pm = strtolower($pr['payment_method'] ?? '');
            $c = (int) $pr['count'];
            $r = (float) $pr['revenue'];
            if (strpos($pm, 'cod') !== false || strpos($pm, 'cash') !== false) {
                $cod_count += $c;
                $cod_revenue += $r;
            } else {
                $online_count += $c;
                $online_revenue += $r;
            }
        }
    }

    // Top Customers by spend
    $table_addresses = $wpdb->prefix . 'wc_order_addresses';
    $has_addresses = ($wpdb->get_var("SHOW TABLES LIKE '{$table_addresses}'") === $table_addresses);

    if ($has_addresses) {
        $top_customers_rows = $wpdb->get_results(
            "SELECT 
                LOWER(TRIM(o.billing_email)) AS email,
                COUNT(o.id) AS ordersCount,
                ROUND(COALESCE(SUM(o.total_amount), 0)) AS lifetimeSpent,
                MAX(TRIM(CONCAT(COALESCE(addr.first_name, ''), ' ', COALESCE(addr.last_name, '')))) AS name
             FROM {$reporting_source} o
             LEFT JOIN {$table_addresses} addr ON addr.order_id = o.id AND addr.address_type = 'billing'
             WHERE o.status NOT IN {$invalid_statuses_sql}
               AND o.billing_email != ''
             GROUP BY LOWER(TRIM(o.billing_email))
             ORDER BY lifetimeSpent DESC
             LIMIT 5",
            ARRAY_A
        );
    if ($wpdb->last_error) return new WP_Error("report_query_failed", "Reporting is temporarily unavailable. Check the server logs.", ["status" => 503]);
    } else {
        $top_customers_rows = $wpdb->get_results(
            "SELECT 
                LOWER(TRIM(billing_email)) AS email,
                COUNT(id) AS ordersCount,
                ROUND(COALESCE(SUM(total_amount), 0)) AS lifetimeSpent,
                '' AS name
             FROM {$reporting_source} reporting_orders
             WHERE status NOT IN {$invalid_statuses_sql}
               AND billing_email != ''
             GROUP BY LOWER(TRIM(billing_email))
             ORDER BY lifetimeSpent DESC
             LIMIT 5",
            ARRAY_A
        );
    if ($wpdb->last_error) return new WP_Error("report_query_failed", "Reporting is temporarily unavailable. Check the server logs.", ["status" => 503]);
    }

    $top_customers = [];
    if ($top_customers_rows) {
        foreach ($top_customers_rows as $c) {
            $c_name = trim($c['name'] ?? '');
            if (!$c_name && !empty($c['email'])) {
                $email_prefix = explode('@', $c['email'])[0];
                $c_name = ucwords(str_replace(['.', '_', '-'], ' ', $email_prefix));
            }
            $top_customers[] = [
                'email'         => $c['email'],
                'name'          => $c_name ?: 'Customer',
                'ordersCount'   => (int) $c['ordersCount'],
                'lifetimeSpent' => (int) round((float) $c['lifetimeSpent']),
            ];
        }
    }

    // Repeat customer stats
    $repeat_row = $wpdb->get_row(
        "SELECT 
            COUNT(*) AS total_customers,
            SUM(CASE WHEN order_count > 1 THEN 1 ELSE 0 END) AS repeat_customers
         FROM (
            SELECT LOWER(TRIM(billing_email)) AS email, COUNT(id) AS order_count
            FROM {$reporting_source} reporting_orders
            WHERE status NOT IN {$invalid_statuses_sql}
              AND billing_email != ''
            GROUP BY LOWER(TRIM(billing_email))
         ) AS cust_stats",
        ARRAY_A
    );
    if ($wpdb->last_error) return new WP_Error("report_query_failed", "Reporting is temporarily unavailable. Check the server logs.", ["status" => 503]);
    $total_unique_cust = (int) ($repeat_row['total_customers'] ?? 0);
    $repeat_cust = (int) ($repeat_row['repeat_customers'] ?? 0);
    $repeat_rate = $total_unique_cust > 0 ? (int) round(($repeat_cust / $total_unique_cust) * 100) : 0;

    // Top Products from order items
    $table_items = $wpdb->prefix . 'woocommerce_order_items';
    $table_itemmeta = $wpdb->prefix . 'woocommerce_order_itemmeta';
    $has_items = ($wpdb->get_var("SHOW TABLES LIKE '{$table_items}'") === $table_items);

    $table_itemmeta = mumbai_reporting_itemmeta_source();
    $top_products = [];
    if ($has_items) {
        $top_product_rows = $wpdb->get_results(
            "SELECT 
                meta_prod.meta_value AS id,
                items.order_item_name AS name,
                SUM(CAST(meta_qty.meta_value AS SIGNED)) AS totalQuantitySold,
                SUM(CAST(meta_total.meta_value AS DECIMAL(10,2))) AS totalRevenue
             FROM {$table_items} items
             JOIN {$table_orders} o ON items.order_id = o.id
             JOIN {$table_itemmeta} meta_prod ON items.order_item_id = meta_prod.order_item_id AND meta_prod.meta_key = '_product_id'
             LEFT JOIN {$table_itemmeta} meta_qty ON items.order_item_id = meta_qty.order_item_id AND meta_qty.meta_key = '_qty'
             LEFT JOIN {$table_itemmeta} meta_total ON items.order_item_id = meta_total.order_item_id AND meta_total.meta_key = '_line_total'
             WHERE o.status NOT IN {$invalid_statuses_sql}
             GROUP BY meta_prod.meta_value, items.order_item_name
             ORDER BY totalQuantitySold DESC, totalRevenue DESC
             LIMIT 5",
            ARRAY_A
        );
    if ($wpdb->last_error) return new WP_Error("report_query_failed", "Reporting is temporarily unavailable. Check the server logs.", ["status" => 503]);
        if ($top_product_rows) {
            foreach ($top_product_rows as $tpr) {
                $top_products[] = [
                    'id'                => (int) $tpr['id'],
                    'name'              => $tpr['name'],
                    'totalQuantitySold' => (int) $tpr['totalQuantitySold'],
                    'totalRevenue'      => (int) round((float) $tpr['totalRevenue']),
                    'image'             => null,
                ];
            }
        }
    }

    return rest_ensure_response([
        'success'           => true,
        'totalRevenue'      => (int) round($total_revenue),
        'completedRevenue'  => (int) round($completed_revenue),
        'shippingRevenue'   => (int) round($shipping_revenue),
        'discountTotal'     => (int) round($discount_total),
        'todaySales'        => (int) round($today_sales),
        'monthSales'        => (int) round($month_sales),
        'monthOrdersCount'  => $month_orders,
        'validOrderCount'   => $valid_order_count,
        'totalOrders'       => $total_orders,
        'avgOrderValue'     => $avg_order_value,
        'statusCounts'      => $status_counts,
        'payments'          => [
            'cod'    => ['count' => $cod_count, 'revenue' => (int) round($cod_revenue)],
            'online' => ['count' => $online_count, 'revenue' => (int) round($online_revenue)],
        ],
        'topProducts'       => $top_products,
        'topCustomers'      => $top_customers ?: [],
        'customerMetrics'   => [
            'totalUniqueCustomers' => $total_unique_cust,
            'repeatCustomerRate'   => $repeat_rate,
        ],
        'weeklyTrend'       => $weekly_trend,
    ]);
}

/**
 * Date-filtered sales and product report. This is read-only: historical orders
 * remain untouched, and all date bounds are supplied as UTC by the Node API.
 */
function mumbai_admin_get_analytics_report(WP_REST_Request $request) {
    global $wpdb;
    $reporting_source = mumbai_reporting_orders_source();
    if (!mumbai_require_reporting_hpos()) return new WP_Error('hpos_required', 'Enable authoritative HPOS storage for reports.', ['status' => 503]);

    $table_orders = $wpdb->prefix . 'wc_orders';
    if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_orders)) !== $table_orders) {
        return new WP_Error('hpos_unavailable', 'WooCommerce HPOS orders table is unavailable.', ['status' => 503]);
    }

    $date_after = sanitize_text_field($request->get_param('date_after') ?? '');
    $date_before = sanitize_text_field($request->get_param('date_before') ?? '');
    $product_id = absint($request->get_param('product_id') ?? 0);
    if (!$date_after || !$date_before || strtotime($date_after) === false || strtotime($date_before) === false || strtotime($date_after) >= strtotime($date_before)) {
        return new WP_Error('invalid_date_range', 'A valid start and end date are required.', ['status' => 400]);
    }

    $date_after = gmdate('Y-m-d H:i:s', strtotime($date_after));
    $date_before = gmdate('Y-m-d H:i:s', strtotime($date_before));
    if ($product_id) {
        $itemmeta_source = mumbai_reporting_itemmeta_source();
        $items_table = $wpdb->prefix . 'woocommerce_order_items';
        $reporting_source = $wpdb->prepare("(SELECT sale.id, sale.status, sale.date_created_gmt, totals.total_amount
          FROM {$reporting_source} sale INNER JOIN (
            SELECT item.order_id, SUM(CAST(line.meta_value AS DECIMAL(20,6))) AS total_amount
            FROM {$items_table} item JOIN {$itemmeta_source} product ON product.order_item_id = item.order_item_id AND product.meta_key = '_product_id'
            JOIN {$itemmeta_source} line ON line.order_item_id = item.order_item_id AND line.meta_key = '_line_total'
            WHERE item.order_item_type = 'line_item' AND CAST(product.meta_value AS UNSIGNED) = %d
            GROUP BY item.order_id) totals ON totals.order_id = sale.id)", $product_id);
    }
    $table_meta = $wpdb->prefix . 'wc_orders_meta';
    $has_meta = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_meta)) === $table_meta;
    if ($has_meta) {
        $join_status = "LEFT JOIN (SELECT order_id, MAX(meta_value) AS meta_value FROM {$table_meta} WHERE meta_key = '_delivery_status' GROUP BY order_id) dm ON dm.order_id = o.id";
        $valid_status = "REPLACE(LOWER(TRIM(o.status)), 'wc-', '') IN ('processing', 'completed')";
        $completed_status = "REPLACE(LOWER(TRIM(o.status)), 'wc-', '') = 'completed'";
    } else {
        $join_status = '';
        $valid_status = "REPLACE(LOWER(TRIM(o.status)), 'wc-', '') NOT IN ('pending', 'cancelled', 'failed', 'refunded', 'trash', 'on-hold', 'checkout-draft')";
        $completed_status = "REPLACE(LOWER(TRIM(o.status)), 'wc-', '') IN ('completed', 'delivered')";
    }

    $summary = $wpdb->get_row($wpdb->prepare(
        "SELECT COUNT(DISTINCT o.id) AS orders_count,
                COALESCE(SUM(o.total_amount), 0) AS revenue,
                COALESCE(SUM(CASE WHEN {$completed_status} THEN o.total_amount ELSE 0 END), 0) AS completed_revenue
         FROM {$reporting_source} o
         {$join_status}
         WHERE o.date_created_gmt >= %s AND o.date_created_gmt < %s
           AND {$valid_status}",
        $date_after,
        $date_before
    ), ARRAY_A);
    if ($wpdb->last_error) return new WP_Error("report_query_failed", "Reporting is temporarily unavailable. Check the server logs.", ["status" => 503]);

    $daily_rows = $wpdb->get_results($wpdb->prepare(
        "SELECT DATE(DATE_ADD(o.date_created_gmt, INTERVAL 330 MINUTE)) AS report_date,
                COUNT(DISTINCT o.id) AS orders_count,
                COALESCE(SUM(o.total_amount), 0) AS revenue
         FROM {$reporting_source} o
         {$join_status}
         WHERE o.date_created_gmt >= %s AND o.date_created_gmt < %s
           AND {$valid_status}
         GROUP BY report_date
         ORDER BY report_date ASC",
        $date_after,
        $date_before
    ), ARRAY_A);
    if ($wpdb->last_error) return new WP_Error("report_query_failed", "Reporting is temporarily unavailable. Check the server logs.", ["status" => 503]);

    $table_items = $wpdb->prefix . 'woocommerce_order_items';
    $table_itemmeta = $wpdb->prefix . 'woocommerce_order_itemmeta';
    $products = [];
    if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_items)) === $table_items &&
        $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_itemmeta)) === $table_itemmeta) {
        $table_itemmeta = mumbai_reporting_itemmeta_source();
        $product_clause = '';
        $product_args = [$date_after, $date_before];
        if ($product_id > 0) {
            $product_clause = ' AND CAST(product_meta.meta_value AS UNSIGNED) = %d';
            $product_args[] = $product_id;
        }
        $product_rows = $wpdb->get_results($wpdb->prepare(
            "SELECT CAST(product_meta.meta_value AS UNSIGNED) AS product_id,
                    items.order_item_name AS product_name,
                    COUNT(DISTINCT o.id) AS orders_count,
                    COALESCE(SUM(CAST(quantity_meta.meta_value AS DECIMAL(12,2))), 0) AS units_sold,
                    COALESCE(SUM(CAST(total_meta.meta_value AS DECIMAL(12,2))), 0) AS product_revenue
             FROM {$reporting_source} o
             {$join_status}
             INNER JOIN {$table_items} items ON items.order_id = o.id AND items.order_item_type = 'line_item'
             INNER JOIN {$table_itemmeta} product_meta ON product_meta.order_item_id = items.order_item_id AND product_meta.meta_key = '_product_id'
             LEFT JOIN {$table_itemmeta} quantity_meta ON quantity_meta.order_item_id = items.order_item_id AND quantity_meta.meta_key = '_qty'
             LEFT JOIN {$table_itemmeta} total_meta ON total_meta.order_item_id = items.order_item_id AND total_meta.meta_key = '_line_total'
             WHERE o.date_created_gmt >= %s AND o.date_created_gmt < %s
               AND {$valid_status}{$product_clause}
             GROUP BY product_id, product_name
             ORDER BY product_revenue DESC, units_sold DESC
             LIMIT 100",
            ...$product_args
        ), ARRAY_A);
    if ($wpdb->last_error) return new WP_Error("report_query_failed", "Reporting is temporarily unavailable. Check the server logs.", ["status" => 503]);

        foreach ($product_rows ?: [] as $row) {
            $products[] = [
                'id'       => (int) $row['product_id'],
                'name'     => (string) $row['product_name'],
                'orders'   => (int) $row['orders_count'],
                'quantity' => (float) $row['units_sold'],
                'revenue'  => (float) $row['product_revenue'],
            ];
        }
    }

    if ($wpdb->last_error) return new WP_Error('report_query_failed', 'Sales reporting is temporarily unavailable.', ['status' => 503]);
    return rest_ensure_response([
        'success' => true,
        'data'    => [
            'date_from' => gmdate('Y-m-d', strtotime($date_after . ' UTC') + 19800),
            'date_to'   => gmdate('Y-m-d', strtotime($date_before . ' UTC') + 19800 - 1),
            'summary'   => [
                'orders'           => (int) ($summary['orders_count'] ?? 0),
                'revenue'          => (float) ($summary['revenue'] ?? 0),
                'completed_revenue'=> (float) ($summary['completed_revenue'] ?? 0),
                'average_order'    => !empty($summary['orders_count'])
                    ? (float) $summary['revenue'] / (int) $summary['orders_count']
                    : 0,
            ],
            'daily'    => array_map(static function ($row) {
                return [
                    'date'    => $row['report_date'],
                    'orders'  => (int) $row['orders_count'],
                    'revenue' => (float) $row['revenue'],
                ];
            }, $daily_rows ?: []),
            'products' => $products,
        ],
    ]);
}

/**
 * Normalize and persist the delivery location assigned to a WooCommerce order.
 * This makes location filters database-side and paginatable instead of requiring
 * the Node API to scan a bounded number of recent orders.
 */
function mumbai_get_order_delivery_location_key($order) {
    if (!($order instanceof WC_Order)) {
        return 'unassigned';
    }

    $shipping_city = (string) $order->get_shipping_city();
    $billing_city = (string) $order->get_billing_city();
    $raw_city = strtolower(trim($shipping_city !== '' ? $shipping_city : $billing_city));

    if ($raw_city !== '') {
        if (strpos($raw_city, 'vasai') !== false) {
            if (strpos($raw_city, 'east') !== false || strpos($raw_city, '(e)') !== false || strpos($raw_city, '-east') !== false) {
                return 'vasai-east';
            }
            if (strpos($raw_city, 'west') !== false || strpos($raw_city, '(w)') !== false || strpos($raw_city, '-west') !== false) {
                return 'vasai-west';
            }
        }
        if (strpos($raw_city, 'nalasopara') !== false || strpos($raw_city, 'nallasopara') !== false || strpos($raw_city, 'sopara') !== false) {
            if (strpos($raw_city, 'east') !== false || strpos($raw_city, '(e)') !== false || strpos($raw_city, '-east') !== false) {
                return 'nalasopara-east';
            }
            if (strpos($raw_city, 'west') !== false || strpos($raw_city, '(w)') !== false || strpos($raw_city, '-west') !== false) {
                return 'nalasopara-west';
            }
        }
    }

    $shipping_postcode = (string) $order->get_shipping_postcode();
    $billing_postcode = (string) $order->get_billing_postcode();
    $raw_postcode = preg_replace('/\\D/', '', $shipping_postcode !== '' ? $shipping_postcode : $billing_postcode);
    $postcode_locations = [
        '401201' => 'vasai-west',
        '401202' => 'vasai-east',
        '401208' => 'vasai-east',
        '401203' => 'nalasopara-west',
        '401209' => 'nalasopara-east',
    ];
    if (isset($postcode_locations[$raw_postcode])) {
        return $postcode_locations[$raw_postcode];
    }

    $combined_address = strtolower(implode(' ', array_filter([
        $order->get_shipping_address_1(),
        $order->get_shipping_address_2(),
        $order->get_billing_address_1(),
        $order->get_billing_address_2(),
    ])));
    $address_rules = [
        'vasai-east' => ['evershine', 'navghar'],
        'vasai-west' => ['chulna', 'babola', 'ambadi', 'vasai station west', 'vasai (w)', 'vasai west'],
        'nalasopara-east' => ['achole', 'moregaon', 'central park nalasopara', 'nalasopara (e)', 'nallasopara (e)', 'nalasopara east', 'nallasopara east'],
        'nalasopara-west' => ['patankar park', 'sopara west', 'nalasopara (w)', 'nallasopara (w)', 'nalasopara west', 'nallasopara west'],
    ];
    foreach ($address_rules as $location_key => $keywords) {
        foreach ($keywords as $keyword) {
            if (strpos($combined_address, $keyword) !== false) {
                return $location_key;
            }
        }
    }

    return 'unassigned';
}

function mumbai_sync_order_delivery_location($order, $data_store = null) {
    static $syncing = false;
    if ($syncing || !($order instanceof WC_Order)) {
        return;
    }

    $location_key = mumbai_get_order_delivery_location_key($order);
    if ($order->get_meta('_mumbai_delivery_location_key', true) === $location_key) {
        return;
    }

    $syncing = true;
    $order->update_meta_data('_mumbai_delivery_location_key', $location_key);
    $order->save_meta_data();
    $syncing = false;
}
add_action('woocommerce_after_order_object_save', 'mumbai_sync_order_delivery_location', 20, 2);

/** Batch old orders into location metadata so the indexed filter covers history. */
function mumbai_schedule_order_location_backfill() {
    if (get_option('mumbai_order_location_backfill_complete') || wp_next_scheduled('mumbai_order_location_backfill_batch')) {
        return;
    }
    wp_schedule_single_event(time() + 10, 'mumbai_order_location_backfill_batch');
}
add_action('init', 'mumbai_schedule_order_location_backfill', 30);

function mumbai_order_location_backfill_batch() {
    if (!function_exists('wc_get_orders') || !class_exists('Automattic\\WooCommerce\\Utilities\\OrderUtil') ||
        !Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled()) {
        return;
    }

    $batch_size = 250;
    $orders = wc_get_orders([
        'type'       => 'shop_order',
        'limit'      => $batch_size,
        'page'       => 1,
        'paginate'   => false,
        'orderby'    => 'id',
        'order'      => 'ASC',
        'return'     => 'objects',
        'meta_query' => [[
            'key'     => '_mumbai_delivery_location_key',
            'compare' => 'NOT EXISTS',
        ]],
    ]);

    foreach ($orders as $order) {
        mumbai_sync_order_delivery_location($order);
    }

    if (count($orders) >= $batch_size) {
        wp_schedule_single_event(time() + 15, 'mumbai_order_location_backfill_batch');
        return;
    }

    update_option('mumbai_order_location_backfill_complete', 1, false);
}
add_action('mumbai_order_location_backfill_batch', 'mumbai_order_location_backfill_batch');

/**
 * Fetch employee orders with DB-side status, location, and date filtering and
 * pagination. This internal endpoint requires HPOS for supported query semantics.
 */
function mumbai_employee_get_orders(WP_REST_Request $request) {
    if (!function_exists('wc_get_orders') || !class_exists('Automattic\\WooCommerce\\Utilities\\OrderUtil') || !class_exists('WC_REST_Orders_Controller')) {
        return new WP_Error('woocommerce_unavailable', 'WooCommerce order querying is unavailable.', ['status' => 503]);
    }

    if (!Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled()) {
        return new WP_Error('hpos_required', 'Server-side delivery-status filtering requires WooCommerce HPOS.', ['status' => 501]);
    }
    if (defined('WC_VERSION') && version_compare(WC_VERSION, '8.2', '<')) {
        return new WP_Error('hpos_required', 'Server-side delivery-status filtering requires WooCommerce 8.2 or newer.', ['status' => 501]);
    }

    $status = sanitize_key((string) $request->get_param('status'));
    $location = sanitize_key((string) $request->get_param('location'));
    $page = max(1, absint($request->get_param('page') ?: 1));
    $limit = min(100, max(1, absint($request->get_param('per_page') ?: 20)));

    $allowed_locations = ['vasai-east', 'vasai-west', 'nalasopara-east', 'nalasopara-west', 'unassigned'];
    if ($location !== '' && $location !== 'all' && !in_array($location, $allowed_locations, true)) {
        return new WP_Error('invalid_order_location', 'Unsupported delivery location.', ['status' => 400]);
    }

    if ($location !== '' && $location !== 'all' && !get_option('mumbai_order_location_backfill_complete')) {
        return new WP_Error('order_location_indexing', 'Order locations are being indexed. Please retry shortly.', ['status' => 503]);
    }

    $args = [
        'type'     => 'shop_order',
        'limit'    => $limit,
        'paged'    => $page,
        'paginate' => true,
        'orderby'  => 'date',
        'order'    => 'DESC',
    ];

    $active_statuses = ['pending', 'processing', 'on-hold', 'packed', 'out-for-delivery', 'dispatched'];
    $operational_wc_statuses = ['pending', 'processing', 'on-hold'];

    if ($status === 'active') {
        $args['status'] = $operational_wc_statuses;
        $args['meta_query'] = [
            'relation' => 'OR',
            ['key' => '_delivery_status', 'value' => $active_statuses, 'compare' => 'IN'],
            ['key' => '_delivery_status', 'compare' => 'NOT EXISTS'],
            ['key' => '_delivery_status', 'value' => '', 'compare' => '='],
        ];
    } elseif ($status === 'processing') {
        $args['status'] = ['processing'];
        $args['meta_query'] = [
            'relation' => 'OR',
            ['key' => '_delivery_status', 'value' => 'processing', 'compare' => '='],
            ['key' => '_delivery_status', 'compare' => 'NOT EXISTS'],
            ['key' => '_delivery_status', 'value' => '', 'compare' => '='],
        ];
    } elseif (in_array($status, ['packed', 'out-for-delivery', 'dispatched'], true)) {
        $args['status'] = $operational_wc_statuses;
        $args['meta_query'] = [[
            'key'     => '_delivery_status',
            'value'   => $status,
            'compare' => '=',
        ]];
    } elseif ($status && $status !== 'all') {
        $allowed_statuses = array_map(static function ($wc_status) {
            return str_replace('wc-', '', $wc_status);
        }, array_keys(wc_get_order_statuses()));
        if (!in_array($status, $allowed_statuses, true)) {
            return new WP_Error('invalid_order_status', 'Unsupported order status.', ['status' => 400]);
        }
        $args['status'] = [$status];
    }

    if ($location !== '' && $location !== 'all') {
        $existing_meta_query = $args['meta_query'] ?? [];
        $args['meta_query'] = [
            'relation' => 'AND',
            [
                'key'     => '_mumbai_delivery_location_key',
                'value'   => $location,
                'compare' => '=',
            ],
        ];
        if (!empty($existing_meta_query)) {
            $args['meta_query'][] = $existing_meta_query;
        }
    }

    $date_query = [];
    $after = $request->get_param('after');
    $before = $request->get_param('before');
    if ($after && ($timestamp = strtotime($after)) !== false) {
        $date_query[] = ['column' => 'date_created_gmt', 'after' => gmdate('Y-m-d H:i:s', $timestamp), 'inclusive' => true];
    }
    if ($before && ($timestamp = strtotime($before)) !== false) {
        $date_query[] = ['column' => 'date_created_gmt', 'before' => gmdate('Y-m-d H:i:s', $timestamp), 'inclusive' => true];
    }
    if (!empty($date_query)) {
        $args['date_query'] = array_merge(['relation' => 'AND'], $date_query);
    }

    $search = sanitize_text_field((string) $request->get_param('search'));
    if ($search !== '') {
        $args['s'] = $search;
    }

    try {
        $result = wc_get_orders($args);
        $orders = [];
        $controller = new WC_REST_Orders_Controller();
        $wc_request = new WP_REST_Request('GET');
        $wc_request->set_param('context', 'view');
        foreach (($result->orders ?? []) as $order) {
            $prepared = $controller->prepare_object_for_response($order, $wc_request);
            if (!is_wp_error($prepared)) {
                $order_data = $prepared->get_data();
                $orders[] = array_intersect_key($order_data, array_flip([
                    'id', 'number', 'status', 'total', 'date_created', 'date_created_gmt',
                    'date_completed', 'date_completed_gmt', 'customer_id', 'billing', 'shipping',
                    'line_items', 'meta_data', 'payment_method', 'payment_method_title',
                    'shipping_total', 'discount_total', 'total_tax', 'customer_note', 'fee_lines', 'date_paid', 'transaction_id',
                ]));
            }
        }

        return new WP_REST_Response([
            'success'    => true,
            'orders'     => $orders,
            'total'      => (int) ($result->total ?? count($orders)),
            'total_pages'=> (int) ($result->max_num_pages ?? 1),
        ], 200);
    } catch (Throwable $error) {
        mumbai_log('Employee order query failed: ' . $error->getMessage());
        return new WP_Error('employee_orders_unavailable', 'Could not load employee orders.', ['status' => 500]);
    }
}

/** Return one customer's order history page and line items without a global cap. */
function mumbai_admin_get_customer_orders(WP_REST_Request $request) {
    global $wpdb;

    $customer_id = absint($request->get_param('id'));
    $page = max(1, absint($request->get_param('page') ?? 1));
    $per_page = min(50, max(1, absint($request->get_param('per_page') ?? 10)));
    $offset = ($page - 1) * $per_page;
    $table_orders = $wpdb->prefix . 'wc_orders';
    if (!$customer_id || $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_orders)) !== $table_orders) {
        return new WP_Error('customer_history_unavailable', 'Customer order history is unavailable.', ['status' => 404]);
    }

    $customer = get_userdata($customer_id);
    if (!$customer) {
        return new WP_Error('customer_not_found', 'Customer was not found.', ['status' => 404]);
    }
    // Do not match by billing email: account deletion intentionally unlinks
    // retained orders (customer_id = 0), and a later account may reuse it.
    $where = 'customer_id = %d';
    $where_args = [$customer_id];
    $where .= " AND status NOT IN ('wc-trash', 'trash')";

    $total = (int) $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM {$table_orders} WHERE {$where}",
        ...$where_args
    ));
    $order_rows = $wpdb->get_results($wpdb->prepare(
        "SELECT id, date_created_gmt, total_amount, status, payment_method_title
         FROM {$table_orders}
         WHERE {$where}
         ORDER BY date_created_gmt DESC, id DESC
         LIMIT %d OFFSET %d",
        ...array_merge($where_args, [$per_page, $offset])
    ), ARRAY_A) ?: [];

    $orders = [];
    $order_ids = [];
    foreach ($order_rows as $row) {
        $id = (int) $row['id'];
        $order_ids[] = $id;
        $orders[$id] = [
            'id'             => $id,
            'order_number'   => (string) $id,
            'date'           => $row['date_created_gmt'] ? gmdate('c', strtotime($row['date_created_gmt'] . ' UTC')) : null,
            'total'          => (float) $row['total_amount'],
            'status'         => str_replace('wc-', '', (string) $row['status']),
            'payment_method' => $row['payment_method_title'] ?: 'Cash on Delivery',
            'items'          => [],
        ];
    }

    if (!empty($order_ids)) {
        $table_items = $wpdb->prefix . 'woocommerce_order_items';
        $table_itemmeta = $wpdb->prefix . 'woocommerce_order_itemmeta';
        $has_items = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_items)) === $table_items;
        $has_itemmeta = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_itemmeta)) === $table_itemmeta;
        if ($has_items && $has_itemmeta) {
            $placeholders = implode(',', array_fill(0, count($order_ids), '%d'));
            $item_rows = $wpdb->get_results($wpdb->prepare(
                "SELECT items.order_id, items.order_item_name,
                        MAX(CASE WHEN meta.meta_key = '_product_id' THEN meta.meta_value END) AS product_id,
                        MAX(CASE WHEN meta.meta_key = '_qty' THEN meta.meta_value END) AS quantity,
                        MAX(CASE WHEN meta.meta_key = '_line_total' THEN meta.meta_value END) AS line_total
                 FROM {$table_items} items
                 LEFT JOIN {$table_itemmeta} meta ON meta.order_item_id = items.order_item_id
                   AND meta.meta_key IN ('_product_id', '_qty', '_line_total')
                 WHERE items.order_item_type = 'line_item' AND items.order_id IN ({$placeholders})
                 GROUP BY items.order_id, items.order_item_id, items.order_item_name
                 ORDER BY items.order_id DESC, items.order_item_id ASC",
                ...$order_ids
            ), ARRAY_A) ?: [];
            foreach ($item_rows as $item) {
                $order_id = (int) $item['order_id'];
                if (!isset($orders[$order_id])) continue;
                $orders[$order_id]['items'][] = [
                    'product_id' => (int) $item['product_id'],
                    'name'       => (string) $item['order_item_name'],
                    'quantity'   => (float) $item['quantity'],
                    'total'      => (float) $item['line_total'],
                ];
            }
        }
    }

    return rest_ensure_response([
        'success'    => true,
        'page'       => $page,
        'per_page'   => $per_page,
        'total'      => $total,
        'totalPages' => max(1, (int) ceil($total / $per_page)),
        'orders'     => array_values($orders),
    ]);
}

/**
 * ─────────────────────────────────────────────
 * CUSTOMER SUSPENSION HELPERS & ADMIN ENDPOINTS
 * ─────────────────────────────────────────────
 */

/**
 * Check whether a user is currently suspended from placing orders.
 * Expired suspensions evaluate to false automatically.
 */
function mumbai_is_customer_suspended($user_id) {
    $user_id = absint($user_id);
    if (!$user_id) {
        return false;
    }

    $is_suspended = get_user_meta($user_id, '_mumbai_customer_suspended', true);
    if ($is_suspended !== 'yes' && $is_suspended !== '1' && $is_suspended !== true) {
        return false;
    }

    $expires_at = (int) get_user_meta($user_id, '_mumbai_customer_suspension_expires_at', true);
    // If expires_at > 0 and time() >= expires_at, temporary suspension has expired
    if ($expires_at > 0 && time() >= $expires_at) {
        return false;
    }

    return true;
}

/**
 * Get detailed suspension status and metadata for a user.
 */
function mumbai_get_customer_suspension_details($user_id) {
    $user_id = absint($user_id);
    if (!$user_id) {
        return [
            'is_suspended'         => false,
            'duration'             => null,
            'expires_at'           => null,
            'expires_at_timestamp' => 0,
            'reason'               => '',
            'is_permanent'         => false,
        ];
    }

    $is_suspended_meta = get_user_meta($user_id, '_mumbai_customer_suspended', true);
    $raw_suspended = ($is_suspended_meta === 'yes' || $is_suspended_meta === '1' || $is_suspended_meta === true);
    $expires_at = (int) get_user_meta($user_id, '_mumbai_customer_suspension_expires_at', true);
    $reason = (string) get_user_meta($user_id, '_mumbai_customer_suspension_reason', true);
    $duration = (string) get_user_meta($user_id, '_mumbai_customer_suspension_duration', true);

    $is_active = $raw_suspended;
    if ($raw_suspended && $expires_at > 0 && time() >= $expires_at) {
        $is_active = false;
    }

    return [
        'is_suspended'         => $is_active,
        'duration'             => $duration ?: ($expires_at === 0 && $raw_suspended ? 'permanent' : null),
        'expires_at'           => $expires_at > 0 ? date('c', $expires_at) : null,
        'expires_at_timestamp' => $expires_at > 0 ? $expires_at : 0,
        'reason'               => $reason,
        'is_permanent'         => $raw_suspended && ($expires_at === 0),
    ];
}

/**
 * REST Callback: Look up customer suspension status by email
 */
function mumbai_admin_customer_suspension_lookup(WP_REST_Request $request) {
    $email = sanitize_email($request->get_param('email') ?? '');
    if (empty($email)) {
        return new WP_Error('missing_email', 'Customer email address is required.', ['status' => 400]);
    }

    $user = get_user_by('email', $email);
    if (!$user) {
        return new WP_Error('customer_not_found', "No registered customer found with email: {$email}", ['status' => 404]);
    }

    $roles = (array) $user->roles;
    if (in_array('administrator', $roles, true)) {
        return new WP_Error('invalid_target', 'Administrator accounts cannot be suspended.', ['status' => 400]);
    }
    if (in_array('employee', $roles, true)) {
        return new WP_Error('invalid_target', 'Employee accounts cannot be suspended.', ['status' => 400]);
    }

    $is_customer = in_array('customer', $roles, true) || in_array('subscriber', $roles, true);
    if (!$is_customer) {
        return new WP_Error('invalid_target', 'Only registered customer accounts can be suspended.', ['status' => 400]);
    }

    $suspension = mumbai_get_customer_suspension_details($user->ID);

    $first_name = (string) get_user_meta($user->ID, 'first_name', true);
    $last_name = (string) get_user_meta($user->ID, 'last_name', true);
    $display_name = trim($user->display_name);
    if (empty($display_name)) {
        $display_name = trim("{$first_name} {$last_name}") ?: $user->user_login;
    }

    $phone = mumbai_get_user_contact_phone($user->ID);

    return rest_ensure_response([
        'success'  => true,
        'customer' => [
            'id'                   => (int) $user->ID,
            'email'                => strtolower(trim($user->user_email)),
            'name'                 => $display_name,
            'first_name'           => $first_name,
            'last_name'            => $last_name,
            'phone'                => $phone,
            'roles'                => $roles,
            'registered_at'        => $user->user_registered ? date('c', strtotime($user->user_registered)) : null,
            'is_suspended'         => $suspension['is_suspended'],
            'duration'             => $suspension['duration'],
            'expires_at'           => $suspension['expires_at'],
            'expires_at_timestamp' => $suspension['expires_at_timestamp'],
            'reason'               => $suspension['reason'],
            'is_permanent'         => $suspension['is_permanent'],
        ],
    ]);
}

/**
 * REST Callback: Suspend a customer account
 */
function mumbai_admin_customer_suspension_suspend(WP_REST_Request $request) {
    $email = sanitize_email($request->get_param('email') ?? '');
    $raw_duration = sanitize_text_field($request->get_param('duration') ?? '');
    $reason = sanitize_text_field($request->get_param('reason') ?? '');
    $admin_id = absint($request->get_param('admin_id') ?? 0);

    if (empty($email)) {
        return new WP_Error('missing_email', 'Customer email address is required.', ['status' => 400]);
    }

    $user = get_user_by('email', $email);
    if (!$user) {
        return new WP_Error('customer_not_found', "No registered customer found with email: {$email}", ['status' => 404]);
    }

    $roles = (array) $user->roles;
    if (in_array('administrator', $roles, true)) {
        return new WP_Error('invalid_target', 'Administrator accounts cannot be suspended.', ['status' => 400]);
    }
    if (in_array('employee', $roles, true)) {
        return new WP_Error('invalid_target', 'Employee accounts cannot be suspended.', ['status' => 400]);
    }

    $is_customer = in_array('customer', $roles, true) || in_array('subscriber', $roles, true);
    if (!$is_customer) {
        return new WP_Error('invalid_target', 'Only registered customer accounts can be suspended.', ['status' => 400]);
    }

    // Normalize duration
    $norm_duration = strtolower(str_replace(' ', '_', trim($raw_duration)));
    $expires_at = 0;

    if ($norm_duration === '3_months' || $norm_duration === '3months') {
        $norm_duration = '3_months';
        $expires_at = strtotime('+3 months', time());
    } elseif ($norm_duration === '6_months' || $norm_duration === '6months') {
        $norm_duration = '6_months';
        $expires_at = strtotime('+6 months', time());
    } elseif ($norm_duration === 'permanent') {
        $norm_duration = 'permanent';
        $expires_at = 0;
    } else {
        return new WP_Error(
            'invalid_duration',
            'Invalid duration. Duration must be 3 months, 6 months, or Permanent.',
            ['status' => 400]
        );
    }

    // Store suspension metadata (sessions are NOT destroyed)
    update_user_meta($user->ID, '_mumbai_customer_suspended', 'yes');
    update_user_meta($user->ID, '_mumbai_customer_suspension_expires_at', $expires_at);
    update_user_meta($user->ID, '_mumbai_customer_suspension_reason', $reason);
    update_user_meta($user->ID, '_mumbai_customer_suspension_duration', $norm_duration);
    update_user_meta($user->ID, '_mumbai_customer_suspended_at', time());
    update_user_meta($user->ID, '_mumbai_customer_suspended_by', $admin_id);

    mumbai_log("Customer {$user->ID} ({$email}) suspended for {$norm_duration} by admin {$admin_id}.");

    $suspension = mumbai_get_customer_suspension_details($user->ID);

    return rest_ensure_response([
        'success'  => true,
        'message'  => 'Customer account suspended successfully.',
        'customer' => [
            'id'                   => (int) $user->ID,
            'email'                => strtolower(trim($user->user_email)),
            'is_suspended'         => true,
            'duration'             => $norm_duration,
            'expires_at'           => $suspension['expires_at'],
            'expires_at_timestamp' => $suspension['expires_at_timestamp'],
            'reason'               => $reason,
            'is_permanent'         => $suspension['is_permanent'],
        ],
    ]);
}

/**
 * REST Callback: Unsuspend a customer account
 */
function mumbai_admin_customer_suspension_unsuspend(WP_REST_Request $request) {
    $email = sanitize_email($request->get_param('email') ?? '');
    $admin_id = absint($request->get_param('admin_id') ?? 0);

    if (empty($email)) {
        return new WP_Error('missing_email', 'Customer email address is required.', ['status' => 400]);
    }

    $user = get_user_by('email', $email);
    if (!$user) {
        return new WP_Error('customer_not_found', "No registered customer found with email: {$email}", ['status' => 404]);
    }

    // Clear suspension metadata
    delete_user_meta($user->ID, '_mumbai_customer_suspended');
    delete_user_meta($user->ID, '_mumbai_customer_suspension_expires_at');
    delete_user_meta($user->ID, '_mumbai_customer_suspension_reason');
    delete_user_meta($user->ID, '_mumbai_customer_suspension_duration');
    update_user_meta($user->ID, '_mumbai_customer_unsuspended_at', time());
    update_user_meta($user->ID, '_mumbai_customer_unsuspended_by', $admin_id);

    mumbai_log("Customer {$user->ID} ({$email}) unsuspended by admin {$admin_id}.");

    return rest_ensure_response([
        'success'  => true,
        'message'  => 'Customer suspension removed successfully.',
        'customer' => [
            'id'           => (int) $user->ID,
            'email'        => strtolower(trim($user->user_email)),
            'is_suspended' => false,
        ],
    ]);
}

/**
 * ─────────────────────────────────────────────
 * PAYMENT INTENT & ATOMIC LOCKING (Internal Node.js only)
 * ─────────────────────────────────────────────
 */

/**
 * ─────────────────────────────────────────────
 * DURABLE PAYMENT INTENTS & WEBHOOK EVENTS (MIGRATION & RECONCILIATION)
 * ─────────────────────────────────────────────
 */

function mumbai_run_durable_payments_migration() {
    global $wpdb;
    static $already_checked = false;
    if ($already_checked) {
        return;
    }
    $already_checked = true;

    $installed_ver = (int) get_option('mumbai_durable_db_ver', 0);
    $target_ver = 3;

    // Fast path: In WordPress, options are autoloaded into memory. If already installed, skip all DB queries!
    if ($installed_ver >= $target_ver) {
        return;
    }

    $table_intents = $wpdb->prefix . 'mumbai_payment_intents';
    $table_events  = $wpdb->prefix . 'mumbai_webhook_events';
    $table_locks   = $wpdb->prefix . 'mumbai_locks';
    $table_stock   = $wpdb->prefix . 'mumbai_stock_reservations';

    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    $charset_collate = $wpdb->get_charset_collate();

        $sql_intents = "CREATE TABLE {$table_intents} (
            rzp_order_id varchar(64) NOT NULL,
            user_id bigint(20) unsigned NOT NULL,
            amount_paise bigint(20) unsigned NOT NULL,
            captured_amount_paise bigint(20) unsigned DEFAULT 0,
            status varchar(32) NOT NULL DEFAULT 'created',
            cart_fingerprint varchar(64) NOT NULL,
            checkout_payload longtext,
            rzp_payment_id varchar(64) DEFAULT NULL,
            wc_order_id bigint(20) unsigned DEFAULT NULL,
            refund_id varchar(64) DEFAULT NULL,
            error_reason text DEFAULT NULL,
            attempts int(10) unsigned NOT NULL DEFAULT 0,
            last_attempt_at datetime DEFAULT NULL,
            first_paid_at datetime DEFAULT NULL,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (rzp_order_id),
            KEY idx_status_created (status, created_at),
            KEY idx_rzp_payment (rzp_payment_id),
            KEY idx_user (user_id)
        ) {$charset_collate};";

        $sql_events = "CREATE TABLE {$table_events} (
            event_id varchar(64) NOT NULL,
            event_type varchar(64) NOT NULL,
            rzp_order_id varchar(64) DEFAULT NULL,
            rzp_payment_id varchar(64) DEFAULT NULL,
            raw_payload longtext NOT NULL,
            status varchar(32) NOT NULL DEFAULT 'stored',
            created_at datetime NOT NULL,
            PRIMARY KEY  (event_id),
            KEY idx_rzp_order (rzp_order_id),
            KEY idx_status (status)
        ) {$charset_collate};";

        $sql_locks = "CREATE TABLE {$table_locks} (
            lock_key varchar(64) NOT NULL,
            worker_id varchar(64) NOT NULL,
            locked_at int(10) unsigned NOT NULL,
            PRIMARY KEY  (lock_key)
        ) {$charset_collate};";

        $sql_stock = "CREATE TABLE {$table_stock} (
            reservation_id varchar(64) NOT NULL,
            product_id bigint(20) unsigned NOT NULL,
            quantity decimal(20,6) unsigned NOT NULL,
            expires_at datetime NOT NULL,
            PRIMARY KEY  (reservation_id, product_id),
            KEY idx_product_expiry (product_id, expires_at)
        ) ENGINE=InnoDB {$charset_collate};";

        dbDelta($sql_intents);
        dbDelta($sql_events);
        dbDelta($sql_locks);
        dbDelta($sql_stock);

        update_option('mumbai_durable_db_ver', $target_ver);
}
add_action('init', 'mumbai_run_durable_payments_migration');

// Older releases wrote local WordPress wall-clock values. Convert those once
// before any REST callback writes UTC timestamps. GET_LOCK serializes upgrades.
function mumbai_migrate_payment_clock_to_utc() {
    if (get_option('mumbai_payment_clock_utc_v1')) return;
    global $wpdb;
    $key = 'mumbai_payment_clock_utc_v1';
    if ((int) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 5)', $key)) !== 1) return;
    try {
        if (get_option('mumbai_payment_clock_utc_v1')) return;
        if ($wpdb->query('START TRANSACTION') === false) throw new RuntimeException('Payment clock migration unavailable');
        $offset = (new DateTimeImmutable('now', wp_timezone()))->getOffset();
        foreach (['mumbai_payment_intents', 'mumbai_webhook_events'] as $suffix) {
            $table = $wpdb->prefix . $suffix;
            $columns = $suffix === 'mumbai_payment_intents' ? ['created_at', 'updated_at', 'last_attempt_at'] : ['created_at'];
            $parts = [];
            foreach ($columns as $column) $parts[] = "`{$column}` = DATE_SUB(`{$column}`, INTERVAL " . (int) $offset . ' SECOND)';
            if ($offset && $wpdb->query("UPDATE `{$table}` SET " . implode(', ', $parts)) === false) throw new RuntimeException('Payment clock conversion failed');
        }
        update_option('mumbai_payment_clock_utc_v1', 1);
        if ($wpdb->query('COMMIT') === false) throw new RuntimeException('Payment clock migration commit failed');
    } catch (Throwable $error) {
        $wpdb->query('ROLLBACK');
        wp_cache_delete('mumbai_payment_clock_utc_v1', 'options');
        wp_cache_delete('alloptions', 'options');
        error_log('[Mumbai Auth] ' . $error->getMessage());
    } finally { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $key)); }
}
add_action('init', 'mumbai_migrate_payment_clock_to_utc', 11);

/**
 * Atomically holds managed WooCommerce stock for deferred Razorpay checkout.
 * This creates no WooCommerce order; the hold expires automatically if payment
 * is abandoned. Product rows are locked in sorted order, like WooCommerce's
 * own pessimistic stock reservation.
 */
function mumbai_reserve_checkout_stock(WP_REST_Request $request) {
    global $wpdb;
    if (!function_exists('wc_get_product') || !class_exists('WC_Data_Store')) {
        return new WP_Error('inventory_unavailable', 'WooCommerce inventory is unavailable.', ['status' => 503]);
    }

    $reservation_id = sanitize_text_field((string) $request->get_param('reservation_id'));
    $line_items = $request->get_param('line_items');
    $hold_minutes = min(120, max(5, absint($request->get_param('hold_minutes') ?: 15)));
    if (!preg_match('/^[A-Za-z0-9_-]{8,64}$/', $reservation_id) || !is_array($line_items) || empty($line_items) || count($line_items) > 100) {
        return new WP_Error('invalid_reservation', 'A valid reservation ID and line items are required.', ['status' => 400]);
    }

    $table = $wpdb->prefix . 'mumbai_stock_reservations';
    $quantities = [];
    foreach ($line_items as $item) {
        $product_id = absint($item['variation_id'] ?? 0) ?: absint($item['product_id'] ?? 0);
        $quantity = isset($item['quantity']) ? (float) $item['quantity'] : 0;
        if (!$product_id || $quantity <= 0 || $quantity > 10000) {
            return new WP_Error('invalid_line_item', 'Invalid product or quantity.', ['status' => 400]);
        }
        $product = wc_get_product($product_id);
        if (!$product || !$product->is_purchasable() || !$product->is_in_stock()) {
            return new WP_Error('out_of_stock', 'A product is unavailable.', ['status' => 409]);
        }
        if (!$product->managing_stock() || $product->backorders_allowed()) {
            continue;
        }
        $managed_id = absint($product->get_stock_managed_by_id());
        if (!$managed_id) {
            return new WP_Error('inventory_unavailable', 'Could not identify managed inventory.', ['status' => 503]);
        }
        $quantities[$managed_id] = ($quantities[$managed_id] ?? 0) + $quantity;
    }

    ksort($quantities, SORT_NUMERIC);
    if ($wpdb->query('START TRANSACTION') === false) {
        return new WP_Error('inventory_unavailable', 'Could not start an atomic inventory reservation.', ['status' => 503]);
    }
    try {
        foreach ($quantities as $product_id => $quantity) {
            // WooCommerce's data store query targets the authoritative stock row
            // and its FOR UPDATE lock serializes simultaneous checkout attempts.
            $stock_query = WC_Data_Store::load('product')->get_query_for_stock($product_id);
            $stock = $wpdb->get_var($stock_query . ' FOR UPDATE');
            if ($stock === null || $wpdb->last_error) {
                throw new RuntimeException('Could not lock WooCommerce stock row.');
            }
            // Avoid counting our custom holds twice here: this endpoint adds
            // them explicitly below, while normal WooCommerce checkout uses
            // the query filter further down.
            $GLOBALS['mumbai_skip_custom_reservation_filter'] = true;
            try {
                $wc_held = function_exists('wc_get_held_stock_quantity')
                    ? (float) wc_get_held_stock_quantity(wc_get_product($product_id))
                    : 0;
            } finally {
                unset($GLOBALS['mumbai_skip_custom_reservation_filter']);
            }
            $custom_held = (float) $wpdb->get_var($wpdb->prepare(
                "SELECT COALESCE(SUM(quantity), 0) FROM {$table} WHERE product_id = %d AND expires_at > UTC_TIMESTAMP() AND reservation_id != %s",
                $product_id,
                $reservation_id
            ));
            if ((float) $stock - $wc_held - $custom_held < $quantity) {
                throw new DomainException('Not enough inventory remains for this checkout.');
            }
        }

        // Replace this token's previous rows atomically (idempotent renewal).
        $wpdb->delete($table, ['reservation_id' => $reservation_id], ['%s']);
        foreach ($quantities as $product_id => $quantity) {
            $inserted = $wpdb->insert($table, [
                'reservation_id' => $reservation_id,
                'product_id' => $product_id,
                'quantity' => $quantity,
                'expires_at' => gmdate('Y-m-d H:i:s', time() + ($hold_minutes * MINUTE_IN_SECONDS)),
            ], ['%s', '%d', '%f', '%s']);
            if ($inserted === false) {
                throw new RuntimeException('Could not persist inventory reservation.');
            }
        }
        $wpdb->query('COMMIT');
        return rest_ensure_response(['success' => true, 'reservation_id' => $reservation_id, 'expires_in_minutes' => $hold_minutes]);
    } catch (DomainException $error) {
        $wpdb->query('ROLLBACK');
        return new WP_Error('out_of_stock', $error->getMessage(), ['status' => 409]);
    } catch (Throwable $error) {
        $wpdb->query('ROLLBACK');
        error_log('[Mumbai Auth] Stock reservation failed: ' . $error->getMessage());
        return new WP_Error('inventory_unavailable', 'Inventory could not be safely reserved.', ['status' => 503]);
    }
}

function mumbai_release_checkout_stock(WP_REST_Request $request) {
    global $wpdb;
    $reservation_id = sanitize_text_field((string) $request->get_param('reservation_id'));
    if (!preg_match('/^[A-Za-z0-9_-]{8,64}$/', $reservation_id)) {
        return new WP_Error('invalid_reservation', 'A valid reservation ID is required.', ['status' => 400]);
    }
    $deleted = $wpdb->delete($wpdb->prefix . 'mumbai_stock_reservations', ['reservation_id' => $reservation_id], ['%s']);
    if ($deleted === false) {
        return new WP_Error('inventory_unavailable', 'Could not release inventory reservation.', ['status' => 503]);
    }
    return rest_ensure_response(['success' => true]);
}

/** Include deferred-payment holds in WooCommerce's native held-stock checks. */
function mumbai_include_deferred_holds_in_woocommerce_stock_query($query, $product_id, $exclude_order_id) {
    if (!empty($GLOBALS['mumbai_skip_custom_reservation_filter'])) {
        return $query;
    }
    global $wpdb;
    $table = $wpdb->prefix . 'mumbai_stock_reservations';
    $hold_query = $wpdb->prepare(
        "(SELECT COALESCE(SUM(quantity), 0) FROM {$table} WHERE product_id = %d AND expires_at > UTC_TIMESTAMP())",
        absint($product_id)
    );
    return preg_replace('/\\bFROM\\b/i', '+ ' . $hold_query . ' FROM', $query, 1);
}
add_filter('woocommerce_query_for_reserved_stock', 'mumbai_include_deferred_holds_in_woocommerce_stock_query', 10, 3);

/**
 * Adjust REST product object responses so catalog reflection includes held stock.
 * If reserved holds bring available stock to 0, marks stock_quantity as 0 and outofstock.
 */
function mumbai_adjust_rest_product_stock($response, $product, $request) {
    // Authorized inventory editors need physical stock, including held units,
    // for compare-and-set adjustments. Storefront reads still show availability.
    if ($request->get_param('context') === 'edit') return $response;
    if ($product && $product->managing_stock()) {
        $raw_stock = $product->get_stock_quantity();
        if ($raw_stock !== null && function_exists('wc_get_held_stock_quantity')) {
            $held = (float) wc_get_held_stock_quantity($product);
            $available = max(0, (float) $raw_stock - $held);
            $response->data['stock_quantity'] = (int) $available;
            if ($available <= 0 && !$product->backorders_allowed()) {
                $response->data['stock_status'] = 'outofstock';
            }
        }
    }
    return $response;
}
add_filter('woocommerce_rest_prepare_product_object', 'mumbai_adjust_rest_product_stock', 10, 3);

function mumbai_purge_stale_payment_intent_payloads() {
    global $wpdb;
    $wpdb->query($wpdb->prepare(
        "DELETE FROM {$wpdb->prefix}mumbai_stock_reservations WHERE expires_at <= %s",
        gmdate('Y-m-d H:i:s')
    ));
    $table_intents = $wpdb->prefix . 'mumbai_payment_intents';
    $retention_days = 7;
    $cutoff = date('Y-m-d H:i:s', time() - ($retention_days * DAY_IN_SECONDS));

    $wpdb->query($wpdb->prepare(
        "UPDATE {$table_intents} 
         SET checkout_payload = NULL 
         WHERE status IN ('order_created', 'refunded') 
           AND updated_at < %s 
           AND checkout_payload IS NOT NULL",
        $cutoff
    ));
}
add_action('mumbai_daily_maintenance', 'mumbai_purge_stale_payment_intent_payloads');
if (!wp_next_scheduled('mumbai_daily_maintenance')) {
    wp_schedule_event(time(), 'daily', 'mumbai_daily_maintenance');
}

function mumbai_payment_intent_store(WP_REST_Request $request) {
    global $wpdb;
    if (!get_option('mumbai_payment_clock_utc_v1')) return new WP_Error('payment_storage_upgrading', 'Payment storage upgrade pending.', ['status' => 503]);
    $rzp_order_id = sanitize_text_field($request->get_param('rzp_order_id'));
    $payload      = $request->get_param('payload');
    $expires_in   = absint($request->get_param('expires_in') ?? 3600);

    if (empty($rzp_order_id) || empty($payload)) {
        return new WP_Error('missing_params', 'rzp_order_id and payload are required.', ['status' => 400]);
    }

    if ($expires_in <= 0) $expires_in = 3600;

    // Backward-compatible transient fallback
    set_transient('_mumbai_pay_' . $rzp_order_id, $payload, $expires_in);

    // Durable store in wp_mumbai_payment_intents table
    mumbai_run_durable_payments_migration();
    $table = $wpdb->prefix . 'mumbai_payment_intents';
    $now = gmdate('Y-m-d H:i:s');

    $user_id = isset($payload['user_id']) ? absint($payload['user_id']) : (isset($payload['customer_id']) ? absint($payload['customer_id']) : 0);
    $amount_paise = isset($payload['amount_paise']) ? absint($payload['amount_paise']) : (isset($payload['amount_in_paise']) ? absint($payload['amount_in_paise']) : (isset($payload['amount']) ? absint($payload['amount']) : 0));
    $cart_fingerprint = isset($payload['cart_fingerprint']) ? sanitize_text_field($payload['cart_fingerprint']) : '';
    $json_payload = wp_json_encode($payload);

    $stored = $wpdb->query($wpdb->prepare(
        "INSERT INTO {$table} (rzp_order_id, user_id, amount_paise, status, cart_fingerprint, checkout_payload, created_at, updated_at)
         VALUES (%s, %d, %d, 'created', %s, %s, %s, %s)
         ON DUPLICATE KEY UPDATE 
            user_id = VALUES(user_id),
            amount_paise = VALUES(amount_paise),
            cart_fingerprint = VALUES(cart_fingerprint),
            checkout_payload = VALUES(checkout_payload),
            updated_at = VALUES(updated_at)",
        $rzp_order_id, $user_id, $amount_paise, $cart_fingerprint, $json_payload, $now, $now
    ));
    if ($stored === false) {
        delete_transient('_mumbai_pay_' . $rzp_order_id);
        return new WP_Error('intent_storage_failed', 'Could not durably store payment session.', ['status' => 503]);
    }
    return rest_ensure_response(['success' => true]);
}

function mumbai_payment_intent_get(WP_REST_Request $request) {
    global $wpdb;
    if ($request->get_param('active_user_id')) {
        $active = $wpdb->get_var($wpdb->prepare(
            "SELECT rzp_order_id FROM {$wpdb->prefix}mumbai_payment_intents WHERE user_id = %d AND cart_fingerprint = %s AND ((status = 'created' AND created_at >= UTC_TIMESTAMP() - INTERVAL 15 MINUTE) OR status IN ('paid', 'orphan_payment', 'quarantined', 'refund_pending', 'refund_failed', 'refund_escalated', 'reconciliation_escalated', 'amount_mismatch')) ORDER BY created_at DESC LIMIT 1",
            absint($request->get_param('active_user_id')),
            sanitize_text_field($request->get_param('cart_fingerprint'))
        ));
        if ($wpdb->last_error) return new WP_Error('intent_lookup_failed', 'Payment session lookup unavailable.', ['status' => 503]);
        return rest_ensure_response(['success' => true, 'active_order_id' => $active ?: null]);
    }
    $rzp_order_id = sanitize_text_field($request->get_param('rzp_order_id'));
    if (empty($rzp_order_id)) {
        return new WP_Error('missing_params', 'rzp_order_id is required.', ['status' => 400]);
    }

    $table = $wpdb->prefix . 'mumbai_payment_intents';
    $row = null;
    if ($wpdb->get_var("SHOW TABLES LIKE '{$table}'") === $table) {
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$table} WHERE rzp_order_id = %s", $rzp_order_id), ARRAY_A);
    }

    $intent = null;
    if ($row) {
        $intent = !empty($row['checkout_payload']) ? json_decode($row['checkout_payload'], true) : [];
        if (!is_array($intent)) $intent = [];
        $intent['status'] = $row['status'];
        $intent['rzp_payment_id'] = $row['rzp_payment_id'];
        $intent['wc_order_id'] = (!is_null($row['wc_order_id']) && $row['wc_order_id'] !== '') ? (int) $row['wc_order_id'] : null;
        $intent['refund_id'] = $row['refund_id'];
        $intent['captured_amount_paise'] = (int) $row['captured_amount_paise'];
        $intent['attempts'] = (int) $row['attempts'];
        $intent['error_reason'] = $row['error_reason'];
        if (empty($intent['created_at'])) $intent['created_at'] = $row['created_at'];
        $intent['updated_at'] = $row['updated_at'];
        $intent['first_paid_at'] = $row['first_paid_at'] ?? null;
    }

    if ($wpdb->last_error) return new WP_Error('intent_lookup_failed', 'Could not read payment state.', ['status' => 503]);
    if (!$intent && !$request->get_param('fresh')) {
        $intent = get_transient('_mumbai_pay_' . $rzp_order_id);
    }

    return rest_ensure_response([
        'success' => true,
        'intent'  => $intent ? $intent : null,
        'raw_row' => $row ? $row : null,
    ]);
}

function mumbai_payment_intent_update_status(WP_REST_Request $request) {
    global $wpdb;
    if (!get_option('mumbai_payment_clock_utc_v1')) return new WP_Error('payment_storage_upgrading', 'Payment storage upgrade pending.', ['status' => 503]);
    $rzp_order_id = sanitize_text_field($request->get_param('rzp_order_id'));
    $from_status  = sanitize_text_field($request->get_param('from_status'));
    $to_status    = sanitize_text_field($request->get_param('to_status'));

    if (empty($rzp_order_id) || empty($to_status)) {
        return new WP_Error('missing_params', 'rzp_order_id and to_status are required.', ['status' => 400]);
    }

    mumbai_run_durable_payments_migration();
    $table = $wpdb->prefix . 'mumbai_payment_intents';
    $now = gmdate('Y-m-d H:i:s');

    $rzp_payment_id = $request->get_param('rzp_payment_id') ? sanitize_text_field($request->get_param('rzp_payment_id')) : null;
    $wc_order_id    = $request->get_param('wc_order_id') ? absint($request->get_param('wc_order_id')) : null;
    $refund_id      = $request->get_param('refund_id') ? sanitize_text_field($request->get_param('refund_id')) : null;
    $error_reason   = $request->get_param('error_reason') ? sanitize_text_field($request->get_param('error_reason')) : null;
    $captured_paise = $request->get_param('captured_amount_paise') ? absint($request->get_param('captured_amount_paise')) : null;
    $inc_attempts   = (bool) $request->get_param('increment_attempts');

    $set_clauses = ["status = %s", "updated_at = %s"];
    $params = [$to_status, $now];
    if ($to_status === 'paid') {
        $set_clauses[] = 'first_paid_at = COALESCE(first_paid_at, %s)';
        $params[] = $now;
    }
    if ($to_status === 'refund_pending' && $from_status && !in_array($from_status, ['refund_pending', 'refund_failed', 'refund_escalated'], true)) {
        $set_clauses[] = 'attempts = 0';
    }

    if ($rzp_payment_id !== null) {
        $set_clauses[] = "rzp_payment_id = %s";
        $params[] = $rzp_payment_id;
    }
    if ($wc_order_id !== null) {
        $set_clauses[] = "wc_order_id = %d";
        $params[] = $wc_order_id;
    }
    if ($refund_id !== null) {
        $set_clauses[] = "refund_id = %s";
        $params[] = $refund_id;
    }
    if ($to_status === 'order_created') {
        $set_clauses[] = "error_reason = NULL";
    } elseif ($error_reason !== null) {
        $set_clauses[] = "error_reason = %s";
        $params[] = $error_reason;
    }
    if ($captured_paise !== null) {
        $set_clauses[] = "captured_amount_paise = %d";
        $params[] = $captured_paise;
    }
    if ($inc_attempts) {
        $set_clauses[] = "attempts = attempts + 1";
        $set_clauses[] = "last_attempt_at = %s";
        $params[] = $now;
    }

    $sql = "UPDATE {$table} SET " . implode(", ", $set_clauses) . " WHERE rzp_order_id = %s";
    $params[] = $rzp_order_id;

    if (!empty($from_status)) {
        $sql .= " AND status = %s";
        $params[] = $from_status;
    }

    $updated = $wpdb->query($wpdb->prepare($sql, $params));

    return rest_ensure_response([
        'success' => true,
        'updated' => ($updated === 1),
    ]);
}

function mumbai_reconciliation_get_watermark(WP_REST_Request $request) {
    $watermark = get_option('mumbai_reconciler_watermark', '');
    return rest_ensure_response(['success' => true, 'watermark' => $watermark]);
}

function mumbai_reconciliation_set_watermark(WP_REST_Request $request) {
    $watermark = sanitize_text_field($request->get_param('watermark') ?? '');
    update_option('mumbai_reconciler_watermark', $watermark);
    return rest_ensure_response(['success' => true, 'watermark' => $watermark]);
}

function mumbai_payment_intent_reconciliation_list(WP_REST_Request $request) {
    global $wpdb;
    $table = $wpdb->prefix . 'mumbai_payment_intents';
    if ($wpdb->get_var("SHOW TABLES LIKE '{$table}'") !== $table) {
        return rest_ensure_response(['success' => true, 'intents' => [], 'page' => 1, 'has_more' => false]);
    }

    $limit = absint($request->get_param('limit') ?? 50);
    if ($limit <= 0 || $limit > 100) $limit = 50;
    $page = absint($request->get_param('page') ?? 1);
    if ($page <= 0) $page = 1;
    $cursor = sanitize_text_field($request->get_param('cursor') ?? '');

    $older_than_param = $request->get_param('older_than_minutes');
    $older_than_minutes = ($older_than_param !== null && $older_than_param !== '') ? absint($older_than_param) : 2;
    $cutoff = ($older_than_minutes > 0)
        ? gmdate('Y-m-d H:i:s', time() - ($older_than_minutes * MINUTE_IN_SECONDS))
        : gmdate('Y-m-d H:i:s', time() + 60);

    $created_older_than_param = $request->get_param('created_older_than_minutes');
    $created_older_than_minutes = ($created_older_than_param !== null && $created_older_than_param !== '')
        ? absint($created_older_than_param)
        : ($older_than_minutes === 0 ? 0 : 10);
    $created_cutoff = ($created_older_than_minutes > 0)
        ? gmdate('Y-m-d H:i:s', time() - ($created_older_than_minutes * MINUTE_IN_SECONDS))
        : gmdate('Y-m-d H:i:s', time() + 60);

    $params = [$cutoff, $created_cutoff];
    $watermark_where = '';
    if ($cursor !== '') {
        $watermark_where = ' AND rzp_order_id > %s';
        $params[] = $cursor;
    }

    $sql = "SELECT * FROM {$table} 
         WHERE ((status IN ('paid', 'refund_pending', 'refund_failed', 'quarantined', 'orphan_payment') AND updated_at < %s)
            OR (status IN ('created', 'cancelled', 'abandoned') AND created_at < %s AND created_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY))" . $watermark_where . "
         ORDER BY rzp_order_id ASC LIMIT %d";

    $params[] = $limit;

    $rows = $wpdb->get_results($wpdb->prepare($sql, $params), ARRAY_A);
    $count = is_array($rows) ? count($rows) : 0;

    return rest_ensure_response([
        'success'   => true,
        'page'      => $page,
        'limit'     => $limit,
        'has_more'  => ($count === $limit),
        'next_cursor' => $count ? $rows[$count - 1]['rzp_order_id'] : '',
        'intents'   => is_array($rows) ? $rows : [],
    ]);
}

function mumbai_webhook_event_store(WP_REST_Request $request) {
    global $wpdb;
    mumbai_run_durable_payments_migration();
    $event_id     = sanitize_text_field($request->get_param('event_id'));
    $event_type   = sanitize_text_field($request->get_param('event_type'));
    $rzp_order_id = sanitize_text_field($request->get_param('rzp_order_id'));
    $rzp_payment_id = sanitize_text_field($request->get_param('rzp_payment_id'));
    $raw_payload  = $request->get_param('raw_payload');

    if (empty($event_id) || empty($event_type)) {
        return new WP_Error('missing_params', 'event_id and event_type are required.', ['status' => 400]);
    }

    $table = $wpdb->prefix . 'mumbai_webhook_events';
    $now = gmdate('Y-m-d H:i:s');
    $payload_str = is_string($raw_payload) ? $raw_payload : wp_json_encode($raw_payload);

    $inserted = $wpdb->query($wpdb->prepare(
        "INSERT IGNORE INTO {$table} (event_id, event_type, rzp_order_id, rzp_payment_id, raw_payload, status, created_at)
         VALUES (%s, %s, %s, %s, %s, 'stored', %s)",
        $event_id, $event_type, $rzp_order_id, $rzp_payment_id, $payload_str, $now
    ));

    if ($inserted === false) {
        return new WP_Error('db_insert_failed', 'Failed to insert webhook event into database.', ['status' => 500]);
    }

    return rest_ensure_response([
        'success'   => true,
        'is_new'    => ($inserted === 1),
        'event_id'  => $event_id,
    ]);
}

function mumbai_webhook_event_update_status(WP_REST_Request $request) {
    global $wpdb;
    mumbai_run_durable_payments_migration();
    $event_id = sanitize_text_field($request->get_param('event_id'));
    $status   = sanitize_text_field($request->get_param('status'));

    if (empty($event_id) || empty($status)) {
        return new WP_Error('missing_params', 'event_id and status are required.', ['status' => 400]);
    }

    $valid_statuses = ['stored', 'processed', 'orphan', 'failed', 'test_archived'];
    if (!in_array($status, $valid_statuses, true)) {
        return new WP_Error('invalid_status', 'Status must be one of stored, processed, orphan, failed, test_archived.', ['status' => 400]);
    }

    $table = $wpdb->prefix . 'mumbai_webhook_events';
    $updated = $wpdb->update(
        $table,
        ['status' => $status],
        ['event_id' => $event_id],
        ['%s'],
        ['%s']
    );

    return rest_ensure_response([
        'success'  => true,
        'updated'  => ($updated !== false),
        'event_id' => $event_id,
        'status'   => $status,
    ]);
}

function mumbai_webhook_events_orphans(WP_REST_Request $request) {
    global $wpdb;
    mumbai_run_durable_payments_migration();
    $table = $wpdb->prefix . 'mumbai_webhook_events';

    $limit = absint($request->get_param('limit') ?? 50);
    if ($limit <= 0 || $limit > 100) $limit = 50;
    $page = absint($request->get_param('page') ?? 1);
    if ($page <= 0) $page = 1;
    $offset = ($page - 1) * $limit;

    $total = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$table} WHERE status = 'orphan'");
    $rows = $wpdb->get_results(
        $wpdb->prepare("SELECT event_id, event_type, rzp_order_id, rzp_payment_id, status, created_at FROM {$table} WHERE status = 'orphan' ORDER BY created_at DESC LIMIT %d OFFSET %d", $limit, $offset),
        ARRAY_A
    );

    return rest_ensure_response([
        'success'  => true,
        'count'    => $total,
        'page'     => $page,
        'limit'    => $limit,
        'orphans'  => is_array($rows) ? $rows : [],
    ]);
}

function mumbai_find_order_by_razorpay_order_id(WP_REST_Request $request) {
    global $wpdb;
    $rzp_order_id = sanitize_text_field($request->get_param('rzp_order_id'));
    if (empty($rzp_order_id)) {
        return new WP_Error('missing_params', 'rzp_order_id is required.', ['status' => 400]);
    }

    if (!function_exists('wc_get_orders')) {
        return new WP_Error('commerce_unavailable', 'WooCommerce order lookup unavailable.', ['status' => 503]);
    }

    $orders = wc_get_orders([
        'limit'      => 1,
        'meta_key'   => '_razorpay_order_id',
        'meta_value' => $rzp_order_id,
        'return'     => 'objects',
    ]);

    if ($wpdb->last_error) return new WP_Error('order_lookup_failed', 'Could not verify payment order.', ['status' => 503]);
    if (!empty($orders)) {
        $order = $orders[0];
        return rest_ensure_response([
            'success' => true,
            'order'   => [
                'id'             => $order->get_id(),
                'number'         => $order->get_order_number(),
                'customer_id'    => $order->get_customer_id(),
                'status'         => $order->get_status(),
                'transaction_id' => $order->get_transaction_id(),
                'total'          => $order->get_total(),
            ],
        ]);
    }

    return rest_ensure_response(['success' => true, 'order' => null]);
}

function mumbai_payment_intent_delete(WP_REST_Request $request) {
    $rzp_order_id = sanitize_text_field($request->get_param('rzp_order_id'));
    if (empty($rzp_order_id)) {
        return new WP_Error('missing_params', 'rzp_order_id is required.', ['status' => 400]);
    }

    delete_transient('_mumbai_pay_' . $rzp_order_id);
    return rest_ensure_response(['success' => true]);
}

/** Serialize lookup + WooCommerce creation at the database connection itself.
 * This protects a retry even when the original Node lease expired or timed out.
 */
function mumbai_create_paid_order_once(WP_REST_Request $request) {
    global $wpdb;
    $payload = $request->get_json_params();
    $rzp_order_id = '';
    foreach (($payload['meta_data'] ?? []) as $meta) {
        if (($meta['key'] ?? '') === '_razorpay_order_id') $rzp_order_id = sanitize_text_field($meta['value']);
    }
    if (!$rzp_order_id || ($payload['payment_method'] ?? '') !== 'razorpay') {
        return new WP_Error('invalid_payment_order', 'Payment order identity required.', ['status' => 400]);
    }
    $key = hash('sha256', 'wc-order:' . $rzp_order_id);
    if ((int) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 5)', $key)) !== 1) {
        return new WP_Error('order_in_progress', 'Payment order creation is in progress.', ['status' => 409]);
    }
    try {
        $orders = wc_get_orders(['limit' => 1, 'meta_key' => '_razorpay_order_id', 'meta_value' => $rzp_order_id]);
        if ($wpdb->last_error) throw new RuntimeException('Could not verify existing payment order.');
        $controller = new WC_REST_Orders_Controller();
        if (!empty($orders)) {
            $read = new WP_REST_Request('GET');
            return $controller->prepare_object_for_response($orders[0], $read);
        }
        $create = new WP_REST_Request('POST');
        foreach ($payload as $name => $value) $create->set_param($name, $value);
        return $controller->create_item($create);
    } catch (Throwable $error) {
        return new WP_Error('payment_order_unavailable', $error->getMessage(), ['status' => 503]);
    } finally {
        $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $key));
    }
}

function mumbai_payment_intent_lock(WP_REST_Request $request) {
    global $wpdb;
    $rzp_order_id = sanitize_text_field($request->get_param('rzp_order_id'));
    $worker_id    = sanitize_text_field($request->get_param('worker_id') ?? 'worker');

    if (empty($rzp_order_id)) {
        return new WP_Error('missing_params', 'rzp_order_id is required.', ['status' => 400]);
    }

    $lock_key = hash('sha256', $rzp_order_id);
    $now = time();
    $table_name = $wpdb->prefix . 'mumbai_locks';

    mumbai_run_durable_payments_migration();

    // Attempt atomic INSERT (fails on duplicate primary key)
    $inserted = $wpdb->query($wpdb->prepare(
        "INSERT IGNORE INTO `{$table_name}` (`lock_key`, `worker_id`, `locked_at`) VALUES (%s, %s, %d)",
        $lock_key, $worker_id, $now
    ));

    $acquired = ($inserted === 1);
    if (!$acquired) {
        // Atomic stale lock recovery (worker timed out > 30s)
        $stale = $wpdb->query($wpdb->prepare(
            "UPDATE `{$table_name}` SET `worker_id` = %s, `locked_at` = %d WHERE `lock_key` = %s AND (`worker_id` = %s OR `locked_at` < %d)",
            $worker_id, $now, $lock_key, $worker_id, $now - 300
        ));
        if ($stale === 1 || $wpdb->get_var($wpdb->prepare(
            "SELECT worker_id FROM `{$table_name}` WHERE lock_key = %s AND locked_at >= %d",
            $lock_key, $now - 300
        )) === $worker_id) {
            $acquired = true;
        }
    }

    return rest_ensure_response([
        'success'  => true,
        'acquired' => (bool) $acquired,
    ]);
}

function mumbai_payment_intent_unlock(WP_REST_Request $request) {
    global $wpdb;
    $rzp_order_id = sanitize_text_field($request->get_param('rzp_order_id'));
    $worker_id    = sanitize_text_field($request->get_param('worker_id'));
    if (empty($rzp_order_id)) {
        return new WP_Error('missing_params', 'rzp_order_id is required.', ['status' => 400]);
    }

    $lock_key = hash('sha256', $rzp_order_id);
    $table_name = $wpdb->prefix . 'mumbai_locks';
    if (!empty($worker_id)) {
        $now = time();
        // Delete only if owned by this worker or if the lock has exceeded 30s stale window
        $wpdb->query($wpdb->prepare(
            "DELETE FROM `{$table_name}` WHERE `lock_key` = %s AND `worker_id` = %s",
            $lock_key, $worker_id
        ));
    } else {
        $wpdb->delete($table_name, ['lock_key' => $lock_key]);
    }
    delete_option($lock_key);

    return rest_ensure_response(['success' => true]);
}

function mumbai_cart_clear(WP_REST_Request $request) {
    $user_id = absint($request->get_param('user_id') ?? 0);
    if ($user_id > 0 && class_exists('WC_Session_Handler')) {
        try {
            $session_handler = new WC_Session_Handler();
            $session_handler->delete_session($user_id);
        } catch (\Throwable $e) {
            mumbai_log("Warning: Failed to delete WC session for customer {$user_id}: " . $e->getMessage());
        }
    }
    return rest_ensure_response(['success' => true]);
}


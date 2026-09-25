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
// Default frontend URL for development
if (!defined('MUMBAI_FRONTEND_URL')) {
    define('MUMBAI_FRONTEND_URL', 'http://localhost:5173');
}
// Maximum failed login attempts before lockout
if (!defined('MUMBAI_MAX_LOGIN_ATTEMPTS')) {
    define('MUMBAI_MAX_LOGIN_ATTEMPTS', 5);
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
        // Generic message — don't reveal whether email exists
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
     */
    $expiration = time() + (30 * DAY_IN_SECONDS);
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
    $email      = sanitize_email($request->get_param('email'));
    $name       = sanitize_text_field($request->get_param('name'));
    $google_sub = sanitize_text_field($request->get_param('google_sub'));

    if (!$email || !$google_sub) {
        return new WP_Error('missing_data', 'Email and Google Sub are required for SSO.', ['status' => 400]);
    }

    $user = null;

    // 1. Try finding by Google Sub
    $users_by_sub = get_users([
        'meta_key'   => '_google_sub',
        'meta_value' => $google_sub,
        'number'     => 1,
        'fields'     => 'all',
    ]);

    if (!empty($users_by_sub)) {
        $user = $users_by_sub[0];
    }

    // 2. Try finding by email (for first-time linking)
    if (!$user) {
        $candidate_user = get_user_by('email', $email);
        
        if ($candidate_user) {
            $user_roles = (array) $candidate_user->roles;
            $is_staff_or_admin = in_array('administrator', $user_roles, true) || in_array('employee', $user_roles, true);

            if ($is_staff_or_admin) {
                $authenticated_user_id = (int) $request->get_param('authenticated_user_id');
                if (!$authenticated_user_id || $authenticated_user_id !== (int) $candidate_user->ID) {
                    return new WP_Error(
                        'sso_linking_not_allowed',
                        'Automatic Google login is disabled for staff and administrator accounts. Please log in with your email and password.',
                        ['status' => 403]
                    );
                }
            }

            // First time linking existing account to Google
            $user = $candidate_user;
            update_user_meta($user->ID, '_google_sub', $google_sub);
            mumbai_log("Linked Google Sub to existing user {$user->ID}");
        }
    }

    // 3. Create new user if no match found
    if (!$user) {
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

        update_user_meta($user_id, '_google_sub', $google_sub);

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
        'user'        => [
            'id'                => $user->ID,
            'name'              => $user->display_name,
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

    if (empty($first_name)) {
        return new WP_Error(
            'missing_first_name',
            'First name is required.',
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
    if (strlen($password) < 8) {
        return new WP_Error(
            'weak_password',
            'Password must be at least 8 characters.',
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
    return [
        'success' => true,
        'message' => 'Account created successfully.',
        'user'    => [
            'id'       => $user->ID,
            'name'     => $user->display_name,
            'email'    => $user->user_email,
            'username' => $user->user_login,
        ],
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
    if (strlen($password) < 8) {
        return new WP_Error(
            'weak_password',
            'Password must be at least 8 characters.',
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
    $user    = $users[0];
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
 * Effective Phone Verification Validator
 * Cryptographically valid ONLY if:
 * 1. _mumbai_is_phone_verified == 1 (or '1' or true)
 * 2. _mumbai_verified_phone is not empty
 * 3. billing_phone === _mumbai_verified_phone (both normalized)
 *
 * If _mumbai_verified_phone is missing, returns false (legacy unverified).
 */
function mumbai_is_user_phone_verified($user_id) {
    if (!$user_id) {
        return false;
    }
    $flag = get_user_meta($user_id, '_mumbai_is_phone_verified', true);
    if (!($flag === '1' || $flag === 1 || $flag === true)) {
        return false;
    }
    $verified_phone = (string) get_user_meta($user_id, '_mumbai_verified_phone', true);
    if (empty($verified_phone)) {
        return false;
    }
    $billing_phone = (string) get_user_meta($user_id, 'billing_phone', true);
    if (empty($billing_phone)) {
        return false;
    }

    $clean_verified = mumbai_normalize_phone($verified_phone);
    $clean_billing = mumbai_normalize_phone($billing_phone);

    return (!empty($clean_verified) && $clean_verified === $clean_billing);
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

    $is_phone_verified = false;
    $is_suspended = false;
    $phone = '';
    $verified_phone = '';
    if ($user) {
        $is_phone_verified = mumbai_is_user_phone_verified($user->ID);
        $is_suspended = function_exists('mumbai_is_customer_suspended') ? mumbai_is_customer_suspended($user->ID) : false;
        $verified_phone = (string) get_user_meta($user->ID, '_mumbai_verified_phone', true);
        $phone = (string) get_user_meta($user->ID, 'billing_phone', true);
        if (empty($phone)) {
            $prof = get_user_meta($user->ID, '_mumbai_user_profile', true);
            if (is_array($prof) && !empty($prof['phone'])) {
                $phone = (string) $prof['phone'];
            }
        }
    }

    return [
        'logged_in'          => $validated_user_id > 0,
        'current_user_id'    => $validated_user_id,
        'email'              => $user ? (string) $user->user_email : '',
        'roles'              => $user ? array_values($user->roles) : [],
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

    if (empty($first_name)) {
        return new WP_Error(
            'missing_first_name',
            'First name is required.',
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

    if (empty($first_name)) {
        return new WP_Error(
            'missing_first_name',
            'First name is required.',
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
    $verified_phone = (string) get_user_meta($user_id, '_mumbai_verified_phone', true);
    $is_phone_verified = mumbai_is_user_phone_verified($user_id);

    $profile = get_user_meta($user_id, '_mumbai_user_profile', true);
    if (!is_array($profile)) {
        $profile = [
            'full_name' => '',
            'age'       => '',
            'phone'     => '',
        ];
    }
    // billing_phone is the canonical phone; sync it to profile
    if (!empty($billing_phone)) {
        $profile['phone'] = $billing_phone;
    }

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
    $first_name = sanitize_text_field($request->get_param('first_name'));
    $last_name  = sanitize_text_field($request->get_param('last_name'));
    $full_name  = sanitize_text_field($request->get_param('full_name'));
    $age        = absint($request->get_param('age'));
    $phone      = sanitize_text_field($request->get_param('phone'));

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

    if (empty($first_name)) {
        return new WP_Error(
            'missing_first_name',
            'First name is required.',
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

    $clean_full_name = trim("{$first_name} {$last_name}");

    if (!$age || !$phone) {
        return new WP_Error(
            'missing_fields',
            'Full name, age and phone are required.',
            ['status' => 400]
        );
    }
    if ($age < 13 || $age > 120) {
        return new WP_Error(
            'invalid_age',
            'Please enter a valid age.',
            ['status' => 400]
        );
    }

    $old_billing_phone = (string) get_user_meta($user_id, 'billing_phone', true);
    $verified_phone = (string) get_user_meta($user_id, '_mumbai_verified_phone', true);

    $clean_phone = mumbai_normalize_phone($phone);
    $clean_old_billing = mumbai_normalize_phone($old_billing_phone);
    $clean_verified = mumbai_normalize_phone($verified_phone);

    // Business rule: Verified phone numbers cannot be changed via standard profile update; phone change requires OTP verification
    if (!empty($verified_phone)) {
        $clean_phone = $clean_verified;
    } else {
        if ($clean_phone !== $clean_old_billing) {
            update_user_meta($user_id, 'billing_phone', $clean_phone);
            update_user_meta($user_id, '_mumbai_is_phone_verified', 0);
            delete_user_meta($user_id, '_mumbai_verified_phone');
        }
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
        'first_name' => $first_name,
        'last_name'  => $last_name,
        'full_name'  => $clean_full_name,
        'age'        => $age,
        'phone'      => $clean_phone,
    ];
    update_user_meta($user_id, '_mumbai_user_profile', $profile);

    $is_phone_verified = mumbai_is_user_phone_verified($user_id);
    $current_verified_phone = (string) get_user_meta($user_id, '_mumbai_verified_phone', true);

    return [
        'success'           => true,
        'message'           => 'Profile saved successfully.',
        'profile'           => $profile,
        'is_phone_verified' => $is_phone_verified,
        'verified_phone'    => $current_verified_phone,
        'billing_phone'     => (string) get_user_meta($user_id, 'billing_phone', true),
    ];
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
    $verified_phone = (string) get_user_meta($user_id, '_mumbai_verified_phone', true);

    $profile_complete =
        !empty($profile['full_name']) &&
        !empty($profile['age']) &&
        !empty($profile['phone']) &&
        $is_phone_verified;
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
     * STEP 1
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
     * STEP 2
     * Load WordPress user deletion functions.
     */
    require_once ABSPATH . 'wp-admin/includes/user.php';

    /*
     * STEP 3
     * Find primary administrator ID to safely reassign any authored content.
     */
    $admin_users = get_users(['role' => 'administrator', 'number' => 1, 'orderby' => 'ID', 'order' => 'ASC']);
    $reassign_id = !empty($admin_users) ? (int) $admin_users[0]->ID : null;

    /*
     * STEP 4
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
     * STEP 5
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
                'Please verify your mobile number with OTP before placing an order.',
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
 * OTP ENDPOINTS & PHONE VERIFICATION HOOKS
 * ─────────────────────────────────────────────
 */

// Reset phone verification when billing_phone changes
add_action('updated_user_meta', 'mumbai_reset_phone_verification', 10, 4);
add_action('added_user_meta', 'mumbai_reset_phone_verification', 10, 4);
function mumbai_reset_phone_verification($meta_id, $user_id, $meta_key, $meta_value) {
    if ($meta_key === 'billing_phone') {
        $verified_phone = (string) get_user_meta($user_id, '_mumbai_verified_phone', true);
        $clean_new = mumbai_normalize_phone((string) $meta_value);
        $clean_verified = mumbai_normalize_phone($verified_phone);

        if (empty($clean_verified) || $clean_new !== $clean_verified) {
            $current = get_user_meta($user_id, '_mumbai_is_phone_verified', true);
            if ($current !== '0' && $current !== 0) {
                update_user_meta($user_id, '_mumbai_is_phone_verified', 0);
            }
            delete_user_meta($user_id, '_mumbai_verified_phone');
        }
    }
}

function mumbai_get_user_by_phone($phone) {
    if (empty($phone)) return null;
    $clean_phone = mumbai_normalize_phone($phone);
    if (empty($clean_phone)) return null;

    $users = get_users([
        'meta_query' => [
            'relation' => 'OR',
            [
                'key'     => 'billing_phone',
                'value'   => $clean_phone,
                'compare' => '=',
            ],
            [
                'key'     => '_mumbai_verified_phone',
                'value'   => $clean_phone,
                'compare' => '=',
            ],
        ],
        'number'     => 1,
        'fields'     => 'all',
    ]);
    return !empty($users) ? $users[0] : null;
}

function mumbai_otp_store(WP_REST_Request $request) {
    $purpose = sanitize_text_field($request->get_param('purpose'));
    $phone = sanitize_text_field($request->get_param('phone'));
    $otp_hash = sanitize_text_field($request->get_param('otp_hash'));
    $user_id = (int) $request->get_param('user_id');

    if (!$phone || !$otp_hash || !in_array($purpose, ['verify_phone', 'reset_password'])) {
        return new WP_Error('invalid_params', 'Missing required parameters.', ['status' => 400]);
    }

    $generic_success = [
        'success' => true,
        'message' => 'If the number is registered, an OTP has been sent.',
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
    } else {
        if (!$user_id) {
            return new WP_Error('missing_user', 'User ID required for phone verification.', ['status' => 400]);
        }
        $user = get_user_by('id', $user_id);
        if (!$user) {
            return new WP_Error('invalid_user', 'Invalid User ID.', ['status' => 400]);
        }

        // Check if phone number is already registered to another user account
        $existing_user = mumbai_get_user_by_phone($phone);
        if ($existing_user && (int) $existing_user->ID !== (int) $user->ID) {
            return new WP_Error('phone_in_use', 'This phone number is already registered to another account.', ['status' => 409]);
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
    $user_id = (int) $request->get_param('user_id');

    if (!$phone || !$otp_hash || !in_array($purpose, ['verify_phone', 'reset_password'])) {
        return new WP_Error('invalid_params', 'Missing required parameters.', ['status' => 400]);
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
    } else {
        if (!$user_id) return new WP_Error('missing_user', 'User ID required.', ['status' => 400]);
        $user = get_user_by('id', $user_id);
        if (!$user) return new WP_Error('invalid_user', 'Invalid User.', ['status' => 400]);

        // Check if phone number is already registered to another user account
        $existing_user = mumbai_get_user_by_phone($phone);
        if ($existing_user && (int) $existing_user->ID !== (int) $user->ID) {
            return new WP_Error('phone_in_use', 'This phone number is already registered to another account.', ['status' => 409]);
        }
    }

    $stored_hash = get_user_meta($user->ID, '_mumbai_otp_hash', true);
    $expires = (int) get_user_meta($user->ID, '_mumbai_otp_expires', true);
    $attempts = (int) get_user_meta($user->ID, '_mumbai_otp_attempts', true);

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

    if ($purpose === 'verify_phone') {
        $clean_phone = mumbai_normalize_phone($phone);
        update_user_meta($user->ID, '_mumbai_verified_phone', $clean_phone);
        update_user_meta($user->ID, 'billing_phone', $clean_phone);
        update_user_meta($user->ID, '_mumbai_is_phone_verified', 1);

        $prof = get_user_meta($user->ID, '_mumbai_user_profile', true);
        if (is_array($prof)) {
            $prof['phone'] = $clean_phone;
            update_user_meta($user->ID, '_mumbai_user_profile', $prof);
        }
        
        return [
            'success'           => true,
            'message'           => 'Phone verified successfully.',
            'phone'             => $clean_phone,
            'verified_phone'    => $clean_phone,
            'is_phone_verified' => true,
        ];
    } else {
        $reset_token = wp_generate_password(64, false, false);
        $reset_token_hash = hash('sha256', $reset_token);
        update_user_meta($user->ID, '_mumbai_reset_auth_token', $reset_token_hash);
        update_user_meta($user->ID, '_mumbai_reset_auth_expires', time() + 900);

        return [
            'success' => true,
            'message' => 'OTP verified. Proceed to reset password.',
            'reset_token' => $reset_token,
        ];
    }
}

function mumbai_otp_reset_password(WP_REST_Request $request) {
    $phone = sanitize_text_field($request->get_param('phone'));
    $reset_token = sanitize_text_field($request->get_param('reset_token'));
    $new_password = $request->get_param('new_password');

    if (!$phone || !$reset_token || !$new_password) {
        return new WP_Error('missing_params', 'Required parameters missing.', ['status' => 400]);
    }
    if (strlen($new_password) < 8) {
        return new WP_Error('weak_password', 'Password must be at least 8 characters.', ['status' => 400]);
    }

    if (is_email($phone)) {
        $user = get_user_by('email', $phone);
    } else {
        $user = mumbai_get_user_by_phone($phone);
    }
    if (!$user) {
        return new WP_Error('invalid_request', 'Invalid request.', ['status' => 400]);
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
 * Mark uploaded media as attached to a product.
 */
function mumbai_mark_media_attached(WP_REST_Request $request) {
    $media_ids = $request->get_param('media_ids');
    $product_id = absint($request->get_param('product_id'));

    if (!is_array($media_ids) || empty($media_ids)) {
        return new WP_Error('invalid_media_ids', 'media_ids array required.', ['status' => 400]);
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

    $instock = max(0, $all - $outofstock - $lowstock);

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
    $users = get_users([
        'number' => 200,
        'fields' => 'all',
    ]);

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

        $phone = (string) get_user_meta($u->ID, 'billing_phone', true);
        if (empty($phone)) {
            $phone = (string) get_user_meta($u->ID, '_mumbai_verified_phone', true);
        }

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

/**
 * REST Callback: Get registered customers list (Admin internal endpoint)
 * Returns all registered users with role customer/subscriber, excluding admins and employees.
 */
function mumbai_admin_get_customers(WP_REST_Request $request) {
    $search = sanitize_text_field($request->get_param('search') ?? '');

    $args = [
        'role__in'     => ['customer', 'subscriber'],
        'role__not_in' => ['administrator', 'employee'],
        'number'       => 1000,
        'fields'       => 'all',
        'orderby'      => 'registered',
        'order'        => 'DESC',
    ];

    if (!empty($search)) {
        $args['search'] = '*' . $search . '*';
        $args['search_columns'] = ['user_login', 'user_email', 'user_nicename', 'display_name'];
    }

    $users = get_users($args);
    $customers = [];

    foreach ($users as $u) {
        $user_id = $u->ID;
        $roles = (array) $u->roles;

        // Strict exclusion of administrator and employee roles
        if (in_array('administrator', $roles, true) || in_array('employee', $roles, true)) {
            continue;
        }

        $email = strtolower(trim($u->user_email));
        $first_name = (string) get_user_meta($user_id, 'first_name', true);
        $last_name = (string) get_user_meta($user_id, 'last_name', true);
        $display_name = trim($u->display_name);
        if (empty($display_name)) {
            $display_name = trim("{$first_name} {$last_name}") ?: $u->user_login;
        }

        $phone = (string) get_user_meta($user_id, 'billing_phone', true);
        if (empty($phone)) {
            $phone = (string) get_user_meta($user_id, '_mumbai_verified_phone', true);
        }

        $addr1 = (string) get_user_meta($user_id, 'billing_address_1', true);
        $addr2 = (string) get_user_meta($user_id, 'billing_address_2', true);
        $city  = (string) get_user_meta($user_id, 'billing_city', true) ?: 'Vasai';
        $state = (string) get_user_meta($user_id, 'billing_state', true) ?: 'Maharashtra';
        $postcode = (string) get_user_meta($user_id, 'billing_postcode', true);

        $address_parts = array_filter([$addr1, $addr2, $city, $state . ($postcode ? " - {$postcode}" : '')]);
        $full_address = implode(', ', $address_parts) ?: 'Vasai, Maharashtra';

        $customers[] = [
            'id'            => (int) $user_id,
            'email'         => $email,
            'name'          => $display_name,
            'first_name'    => $first_name,
            'last_name'     => $last_name,
            'phone'         => $phone,
            'location'      => "{$city}, {$state}",
            'full_address'  => $full_address,
            'registered_at' => $u->user_registered ? date('c', strtotime($u->user_registered)) : null,
            'roles'         => $roles,
        ];
    }

    return rest_ensure_response([
        'success'   => true,
        'customers' => $customers,
        'count'     => count($customers),
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

    $phone = (string) get_user_meta($user->ID, 'billing_phone', true);
    if (empty($phone)) {
        $phone = (string) get_user_meta($user->ID, '_mumbai_verified_phone', true);
    }

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
    $installed_ver = (int) get_option('mumbai_durable_db_ver', 0);
    $target_ver = 1;

    $table_intents = $wpdb->prefix . 'mumbai_payment_intents';
    $table_events  = $wpdb->prefix . 'mumbai_webhook_events';
    $table_locks   = $wpdb->prefix . 'mumbai_locks';

    $tables_missing = (
        $wpdb->get_var("SHOW TABLES LIKE '{$table_intents}'") !== $table_intents ||
        $wpdb->get_var("SHOW TABLES LIKE '{$table_events}'") !== $table_events ||
        $wpdb->get_var("SHOW TABLES LIKE '{$table_locks}'") !== $table_locks
    );

    if ($installed_ver < $target_ver || $tables_missing) {
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

        dbDelta($sql_intents);
        dbDelta($sql_events);
        dbDelta($sql_locks);

        update_option('mumbai_durable_db_ver', $target_ver);
    }
}
add_action('init', 'mumbai_run_durable_payments_migration');

function mumbai_purge_stale_payment_intent_payloads() {
    global $wpdb;
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
    $now = current_time('mysql');

    $user_id = isset($payload['user_id']) ? absint($payload['user_id']) : 0;
    $amount_paise = isset($payload['amount']) ? absint($payload['amount']) : 0;
    $cart_fingerprint = isset($payload['cart_fingerprint']) ? sanitize_text_field($payload['cart_fingerprint']) : '';
    $json_payload = wp_json_encode($payload);

    $wpdb->query($wpdb->prepare(
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

    return rest_ensure_response(['success' => true]);
}

function mumbai_payment_intent_get(WP_REST_Request $request) {
    global $wpdb;
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
        $intent['created_at'] = $row['created_at'];
        $intent['updated_at'] = $row['updated_at'];
    }

    if (!$intent) {
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
    $rzp_order_id = sanitize_text_field($request->get_param('rzp_order_id'));
    $from_status  = sanitize_text_field($request->get_param('from_status'));
    $to_status    = sanitize_text_field($request->get_param('to_status'));

    if (empty($rzp_order_id) || empty($to_status)) {
        return new WP_Error('missing_params', 'rzp_order_id and to_status are required.', ['status' => 400]);
    }

    mumbai_run_durable_payments_migration();
    $table = $wpdb->prefix . 'mumbai_payment_intents';
    $now = current_time('mysql');

    $rzp_payment_id = $request->get_param('rzp_payment_id') ? sanitize_text_field($request->get_param('rzp_payment_id')) : null;
    $wc_order_id    = $request->get_param('wc_order_id') ? absint($request->get_param('wc_order_id')) : null;
    $refund_id      = $request->get_param('refund_id') ? sanitize_text_field($request->get_param('refund_id')) : null;
    $error_reason   = $request->get_param('error_reason') ? sanitize_text_field($request->get_param('error_reason')) : null;
    $captured_paise = $request->get_param('captured_amount_paise') ? absint($request->get_param('captured_amount_paise')) : null;
    $inc_attempts   = (bool) $request->get_param('increment_attempts');

    $set_clauses = ["status = %s", "updated_at = %s"];
    $params = [$to_status, $now];

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
    $offset = ($page - 1) * $limit;

    $older_than_param = $request->get_param('older_than_minutes');
    $older_than_minutes = ($older_than_param !== null && $older_than_param !== '') ? absint($older_than_param) : 2;
    $cutoff = ($older_than_minutes > 0)
        ? date('Y-m-d H:i:s', time() - ($older_than_minutes * MINUTE_IN_SECONDS))
        : date('Y-m-d H:i:s', time() + 60);

    $created_older_than_param = $request->get_param('created_older_than_minutes');
    $created_older_than_minutes = ($created_older_than_param !== null && $created_older_than_param !== '')
        ? absint($created_older_than_param)
        : ($older_than_minutes === 0 ? 0 : 10);
    $created_cutoff = ($created_older_than_minutes > 0)
        ? date('Y-m-d H:i:s', time() - ($created_older_than_minutes * MINUTE_IN_SECONDS))
        : date('Y-m-d H:i:s', time() + 60);

    // Overlapping window: if watermark provided, overlap by 5 minutes (300 seconds)
    $watermark = sanitize_text_field($request->get_param('watermark') ?? '');
    $params = [$cutoff, $created_cutoff];
    $watermark_where = "";

    if (!empty($watermark)) {
        $watermark_ts = strtotime($watermark);
        if ($watermark_ts) {
            $overlap_cutoff = date('Y-m-d H:i:s', $watermark_ts - 300);
            $watermark_where = " AND updated_at >= %s";
            $params[] = $overlap_cutoff;
        }
    }

    $sql = "SELECT * FROM {$table} 
         WHERE ((status IN ('paid', 'refund_pending', 'refund_failed') AND updated_at < %s)
            OR (status = 'created' AND created_at < %s))" . $watermark_where . "
         ORDER BY updated_at ASC LIMIT %d OFFSET %d";

    $params[] = $limit;
    $params[] = $offset;

    $rows = $wpdb->get_results($wpdb->prepare($sql, $params), ARRAY_A);
    $count = is_array($rows) ? count($rows) : 0;

    return rest_ensure_response([
        'success'   => true,
        'page'      => $page,
        'limit'     => $limit,
        'has_more'  => ($count === $limit),
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
    $now = current_time('mysql');
    $payload_str = is_string($raw_payload) ? $raw_payload : wp_json_encode($raw_payload);

    $inserted = $wpdb->query($wpdb->prepare(
        "INSERT IGNORE INTO {$table} (event_id, event_type, rzp_order_id, rzp_payment_id, raw_payload, status, created_at)
         VALUES (%s, %s, %s, %s, %s, 'stored', %s)",
        $event_id, $event_type, $rzp_order_id, $rzp_payment_id, $payload_str, $now
    ));

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

    $valid_statuses = ['stored', 'processed', 'orphan', 'failed'];
    if (!in_array($status, $valid_statuses, true)) {
        return new WP_Error('invalid_status', 'Status must be one of stored, processed, orphan, failed.', ['status' => 400]);
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
    $rzp_order_id = sanitize_text_field($request->get_param('rzp_order_id'));
    if (empty($rzp_order_id)) {
        return new WP_Error('missing_params', 'rzp_order_id is required.', ['status' => 400]);
    }

    if (!function_exists('wc_get_orders')) {
        return rest_ensure_response(['success' => true, 'order' => null]);
    }

    $orders = wc_get_orders([
        'limit'      => 1,
        'meta_key'   => '_razorpay_order_id',
        'meta_value' => $rzp_order_id,
        'return'     => 'objects',
    ]);

    if (!empty($orders)) {
        $order = $orders[0];
        return rest_ensure_response([
            'success' => true,
            'order'   => [
                'id'             => $order->get_id(),
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

function mumbai_payment_intent_lock(WP_REST_Request $request) {
    global $wpdb;
    $rzp_order_id = sanitize_text_field($request->get_param('rzp_order_id'));
    $worker_id    = sanitize_text_field($request->get_param('worker_id') ?? 'worker');

    if (empty($rzp_order_id)) {
        return new WP_Error('missing_params', 'rzp_order_id is required.', ['status' => 400]);
    }

    $lock_key = '_mumbai_lock_' . $rzp_order_id;
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
            "UPDATE `{$table_name}` SET `worker_id` = %s, `locked_at` = %d WHERE `lock_key` = %s AND `locked_at` < %d",
            $worker_id, $now, $lock_key, $now - 30
        ));
        if ($stale === 1) {
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
    if (empty($rzp_order_id)) {
        return new WP_Error('missing_params', 'rzp_order_id is required.', ['status' => 400]);
    }

    $lock_key = '_mumbai_lock_' . $rzp_order_id;
    $table_name = $wpdb->prefix . 'mumbai_locks';
    $wpdb->delete($table_name, ['lock_key' => $lock_key]);
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


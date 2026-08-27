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
if (!defined('MUMBAI_INTERNAL_API_KEY')) {
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
        $is_internal = defined('MUMBAI_INTERNAL_API_KEY') && !empty($internal_key) && hash_equals(MUMBAI_INTERNAL_API_KEY, $internal_key);

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
    // Health check
    register_rest_route('mumbai-auth/v1', '/test', [
        'methods'             => 'GET',
        'callback'            => function () {
            return [
                'success' => true,
                'message' => 'Mumbai Auth API Working',
            ];
        },
        'permission_callback' => '__return_true',
    ]);
    // Auth endpoints (public)
    register_rest_route('mumbai-auth/v1', '/login', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_login',
        'permission_callback' => '__return_true',
    ]);
    register_rest_route('mumbai-auth/v1', '/register', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_register',
        'permission_callback' => '__return_true',
    ]);
    register_rest_route('mumbai-auth/v1', '/forgot-password', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_forgot_password',
        'permission_callback' => '__return_true',
    ]);
    register_rest_route('mumbai-auth/v1', '/reset-password', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_reset_password',
        'permission_callback' => '__return_true',
    ]);
    register_rest_route('mumbai-auth/v1', '/logout', [
        'methods'             => 'POST',
        'callback'            => 'mumbai_logout',
        'permission_callback' => '__return_true',
    ]);
    register_rest_route('mumbai-auth/v1', '/me', [
        'methods'             => 'GET',
        'callback'            => 'mumbai_me',
        'permission_callback' => '__return_true',
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
    $name     = sanitize_text_field($request->get_param('name'));
    $email    = sanitize_email($request->get_param('email'));
    $password = $request->get_param('password');
    if (!$name || !$email || !$password) {
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
        'display_name' => $name,
        'nickname'     => $name,
    ]);
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

    return [
        'logged_in'       => $validated_user_id > 0,
        'current_user_id' => $validated_user_id,
        'roles'           => $user ? array_values($user->roles) : [],
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
    if (!defined('MUMBAI_INTERNAL_API_KEY')) {
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
    if (!hash_equals(MUMBAI_INTERNAL_API_KEY, $api_key)) {
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
    $full_name     = sanitize_text_field($request->get_param('full_name'));
    $phone         = sanitize_text_field($request->get_param('phone'));
    $address_line1 = sanitize_text_field($request->get_param('address_line1'));
    $address_line2 = sanitize_text_field($request->get_param('address_line2'));
    $city          = sanitize_text_field($request->get_param('city'));
    $state         = sanitize_text_field($request->get_param('state'));
    $pincode       = sanitize_text_field($request->get_param('pincode'));
    if (!in_array($type, ['home', 'office'], true)) {
        return new WP_Error(
            'invalid_address_type',
            'Address type must be home or office.',
            ['status' => 400]
        );
    }
    if (!$full_name || !$phone || !$address_line1 || !$city || !$state) {
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
        'full_name'     => $full_name,
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
    $full_name     = sanitize_text_field($request->get_param('full_name'));
    $phone         = sanitize_text_field($request->get_param('phone'));
    $address_line1 = sanitize_text_field($request->get_param('address_line1'));
    $address_line2 = sanitize_text_field($request->get_param('address_line2'));
    $city          = sanitize_text_field($request->get_param('city'));
    $state         = sanitize_text_field($request->get_param('state'));
    $pincode       = sanitize_text_field($request->get_param('pincode'));
    if (!in_array($type, ['home', 'office'], true)) {
        return new WP_Error(
            'invalid_address_type',
            'Address type must be home or office.',
            ['status' => 400]
        );
    }
    if (!$full_name || !$phone || !$address_line1 || !$city || !$state) {
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
                'full_name'     => $full_name,
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
    $profile = get_user_meta($user_id, '_mumbai_user_profile', true);
    if (!is_array($profile)) {
        $profile = [
            'full_name' => '',
            'age'       => '',
            'phone'     => '',
        ];
    }
    return [
        'success' => true,
        'profile' => $profile,
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
    $full_name = sanitize_text_field($request->get_param('full_name'));
    $age       = absint($request->get_param('age'));
    $phone     = sanitize_text_field($request->get_param('phone'));
    if (!$full_name || !$age || !$phone) {
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
    $profile = [
        'full_name' => $full_name,
        'age'       => $age,
        'phone'     => $phone,
    ];
    update_user_meta($user_id, '_mumbai_user_profile', $profile);
    return [
        'success' => true,
        'message' => 'Profile saved successfully.',
        'profile' => $profile,
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
    $profile_complete =
        !empty($profile['full_name']) &&
        !empty($profile['age']) &&
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
    return [
        'success'          => true,
        'complete'         => $complete,
        'profile_complete' => $profile_complete,
        'address_complete' => $has_address,
        'profile'          => $profile,
        'addresses'        => $addresses,
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

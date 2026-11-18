<?php
/**
 * Runtime PHP 8.2 regression tests proving:
 * 1. Shared mumbai_reset_ lock + _mumbai_credential_version prevent OTP/reset races
 *    and protect against partial failure when session revocation errors after reset_password().
 * 2. Failed Google SSO _google_sub persistence rolls back newly created accounts cleanly
 *    so retry succeeds, and returns explicit email-recovery guidance if rollback fails.
 * 3. Account deletion checks eligibility (active orders) BEFORE consuming delete_token,
 *    consumes it once eligible under mumbai_delete_ lock, and rejects concurrent/replay attempts.
 */

$stubRoot = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'mumbai_wp_test_stub_' . getmypid();
@mkdir($stubRoot . '/wp-admin/includes', 0777, true);
file_put_contents($stubRoot . '/wp-admin/includes/user.php', "<?php\n");
register_shutdown_function(function () use ($stubRoot) {
    @unlink($stubRoot . '/wp-admin/includes/user.php');
    @rmdir($stubRoot . '/wp-admin/includes');
    @rmdir($stubRoot . '/wp-admin');
    @rmdir($stubRoot);
});
define('ABSPATH', $stubRoot . '/');
define('DAY_IN_SECONDS', 86400);
define('MINUTE_IN_SECONDS', 60);
define('LOGGED_IN_COOKIE', 'wp_logged_in');
define('MUMBAI_FRONTEND_URL', 'https://store.example');

class WP_Error {
    public $code;
    public $message;
    public $data;
    public function __construct($code, $message = '', $data = []) {
        $this->code = $code;
        $this->message = $message;
        $this->data = $data;
    }
    public function get_error_code() { return $this->code; }
    public function get_error_message() { return $this->message; }
    public function get_error_data() { return $this->data; }
}

class WP_REST_Request {
    private $params;
    private $headers;
    public function __construct($params = [], $headers = []) {
        $this->params = $params;
        $this->headers = $headers;
    }
    public function get_param($key) { return $this->params[$key] ?? null; }
    public function get_header($key) { return $this->headers[$key] ?? null; }
}

class WP_User {
    public $ID;
    public $user_email;
    public $display_name;
    public $user_login;
    public $user_pass;
    public $roles;
    public function __construct($id, $email = '', $roles = ['customer']) {
        $this->ID = $id;
        $this->user_email = $email;
        $this->display_name = 'User ' . $id;
        $this->user_login = $email ?: ('user_' . $id);
        $this->user_pass = 'hashed_pw';
        $this->roles = $roles;
        if (!isset($GLOBALS['test_users'][$id])) {
            $GLOBALS['test_users'][$id] = $this;
        }
    }
    public function set_role($role) {
        $this->roles = [$role];
        $GLOBALS['test_users'][$this->ID]->roles = [$role];
    }
}

class WP_Session_Tokens {
    public static function get_instance($user_id) {
        return new class($user_id) {
            private $uid;
            public function __construct($uid) { $this->uid = $uid; }
            public function destroy_all() {
                $GLOBALS['destroyed_sessions'][] = $this->uid;
                unset($GLOBALS['test_sessions'][$this->uid]);
            }
            public function destroy($tok) {
                unset($GLOBALS['test_sessions'][$this->uid][$tok]);
            }
            public function create($exp) {
                $tok = 'tok_' . $this->uid . '_' . $exp . '_' . count($GLOBALS['test_sessions'][$this->uid] ?? []);
                $GLOBALS['test_sessions'][$this->uid][$tok] = ['login' => time(), 'expiration' => $exp];
                return $tok;
            }
            public function get($tok) { return $GLOBALS['test_sessions'][$this->uid][$tok] ?? null; }
            public function update($tok, $sess) { $GLOBALS['test_sessions'][$this->uid][$tok] = $sess; }
        };
    }
}

$GLOBALS['test_users'] = [];
$GLOBALS['test_meta'] = [];
$GLOBALS['test_mails'] = [];
$GLOBALS['held_locks'] = [];
$GLOBALS['lock_log'] = [];
$GLOBALS['drop_google_sub_write'] = false;
$GLOBALS['fail_user_delete'] = false;
$GLOBALS['active_orders_by_user'] = [];
$GLOBALS['destroyed_sessions'] = [];
$GLOBALS['deleted_users'] = [];
$GLOBALS['next_user_id'] = 500;
$GLOBALS['fail_session_lock'] = false;
$GLOBALS['drop_session_version_write'] = false;
$GLOBALS['on_before_session_lock'] = null;
$GLOBALS['test_transients'] = [];
$GLOBALS['cache_deletes'] = [];

$GLOBALS['wpdb'] = new class {
    public $prefix = 'wp_';
    public $usermeta = 'wp_usermeta';
    public $last_error = '';
    public function prepare($q, ...$args) {
        $i = 0;
        return preg_replace_callback('/%[sd]/', function ($m) use ($args, &$i) {
            $val = $args[$i++] ?? '';
            return $m[0] === '%d' ? (string) ((int) $val) : "'" . str_replace("'", "\\'", (string) $val) . "'";
        }, $q);
    }
    public function get_var($q) {
        if (preg_match("/SELECT GET_LOCK\('([^']+)'/", $q, $m)) {
            $name = $m[1];
            if (is_callable($GLOBALS['on_before_session_lock']) && str_starts_with($name, 'mumbai_sess_lock_')) {
                $hook = $GLOBALS['on_before_session_lock'];
                $GLOBALS['on_before_session_lock'] = null;
                $hook($name);
            }
            $GLOBALS['lock_log'][] = ['acquire', $name];
            if ($GLOBALS['fail_session_lock'] && str_starts_with($name, 'mumbai_sess_lock_')) {
                return 0;
            }
            if (!empty($GLOBALS['held_locks'][$name])) {
                return 0;
            }
            $GLOBALS['held_locks'][$name] = true;
            return 1;
        }
        if (preg_match("/SELECT RELEASE_LOCK\('([^']+)'/", $q, $m)) {
            $name = $m[1];
            $GLOBALS['lock_log'][] = ['release', $name];
            unset($GLOBALS['held_locks'][$name]);
            return 1;
        }
        return 1;
    }
    public function query($q) {
        if (preg_match("/SELECT RELEASE_LOCK\('([^']+)'/", $q, $m)) {
            $name = $m[1];
            $GLOBALS['lock_log'][] = ['release', $name];
            unset($GLOBALS['held_locks'][$name]);
        }
        return 1;
    }
    public function get_results($q) { return []; }
    public function replace($table, $data, $format = null) { return 1; }
    public function delete($table, $where, $format = null) { return 1; }
    public function get_charset_collate() { return ''; }
};

function add_action(...$a) {}
function add_filter(...$a) {}
function register_rest_route(...$a) {}
function wp_next_scheduled(...$a) { return true; }
function wp_schedule_event(...$a) {}
function register_activation_hook(...$a) {}
function register_deactivation_hook(...$a) {}
function is_wp_error($v) { return $v instanceof WP_Error; }
function absint($v) { return abs((int) $v); }
function sanitize_text_field($v) { return trim((string) $v); }
function sanitize_email($v) { return trim((string) $v); }
function sanitize_user($v, $strict = false) { return preg_replace('/[^a-zA-Z0-9_.-]/', '', (string) $v); }
function is_email($v) { return (bool) filter_var($v, FILTER_VALIDATE_EMAIL); }
function wp_generate_password($len = 12) { return substr(bin2hex(random_bytes(max(16, $len))), 0, $len); }
function wp_cache_delete($id, $group = '') { $GLOBALS['cache_deletes'][] = [$id, $group]; }
function clean_user_cache($id) {}
function get_transient($key) { return $GLOBALS['test_transients'][$key] ?? false; }
function set_transient($key, $val, $ttl = 0) { $GLOBALS['test_transients'][$key] = $val; return true; }
function delete_transient($key) { unset($GLOBALS['test_transients'][$key]); return true; }
function wp_validate_auth_cookie($cookie, $scheme = '') {
    if (preg_match('/^cookie_(\d+)_(.+)$/', (string) $cookie, $m)) {
        return (int) $m[1];
    }
    return false;
}
function wp_parse_auth_cookie($cookie, $scheme = '') {
    if (preg_match('/^cookie_(\d+)_(.+)$/', (string) $cookie, $m)) {
        return ['username' => 'u' . $m[1], 'token' => $m[2]];
    }
    return false;
}
function wp_get_session_token() { return ''; }
function wp_mail($to, $sub, $msg) { $GLOBALS['test_mails'][] = [$to, $sub, $msg]; return true; }
function username_exists($u) {
    foreach ($GLOBALS['test_users'] as $user) {
        if (strtolower($user->user_login) === strtolower($u)) return $user->ID;
    }
    return false;
}
function wp_create_user($username, $password, $email) {
    $id = $GLOBALS['next_user_id']++;
    $u = new WP_User($id, $email, ['customer']);
    $u->user_login = $username;
    $u->user_pass = $password;
    $GLOBALS['test_users'][$id] = $u;
    return $id;
}
function wp_update_user($args) {
    $id = (int) ($args['ID'] ?? 0);
    if (isset($GLOBALS['test_users'][$id])) {
        if (isset($args['display_name'])) $GLOBALS['test_users'][$id]->display_name = $args['display_name'];
    }
    return $id;
}
function wp_delete_user($id, $reassign = null) {
    if ($GLOBALS['fail_user_delete']) return false;
    unset($GLOBALS['test_users'][$id], $GLOBALS['test_meta'][$id]);
    $GLOBALS['deleted_users'][] = $id;
    return true;
}
function get_user_by($field, $val) {
    foreach ($GLOBALS['test_users'] as $u) {
        if ($field === 'id' && (int) $u->ID === (int) $val) return $u;
        if ($field === 'email' && strtolower($u->user_email) === strtolower((string) $val)) return $u;
        if ($field === 'login' && strtolower($u->user_login) === strtolower((string) $val)) return $u;
    }
    return false;
}
function get_userdata($id) { return get_user_by('id', $id); }
function get_users($args = []) {
    $out = [];
    foreach ($GLOBALS['test_users'] as $u) {
        if (!empty($args['meta_key'])) {
            $mv = $GLOBALS['test_meta'][$u->ID][$args['meta_key']] ?? '';
            if ((string) $mv !== (string) ($args['meta_value'] ?? '')) continue;
        }
        if (!empty($args['role']) && !in_array($args['role'], (array) $u->roles, true)) continue;
        $out[] = $u;
    }
    return !empty($args['number']) ? array_slice($out, 0, (int) $args['number']) : $out;
}
function get_user_meta($id, $key, $single = false) { return $GLOBALS['test_meta'][$id][$key] ?? ''; }
function update_user_meta($id, $key, $val) {
    if ($key === '_google_sub' && $GLOBALS['drop_google_sub_write']) {
        return false; // Simulate failed meta write
    }
    if ($key === '_mumbai_session_version' && $GLOBALS['drop_session_version_write']) {
        return false; // Simulate failed session-version persistence inside lock
    }
    $GLOBALS['test_meta'][$id][$key] = $val;
    return true;
}
function delete_user_meta($id, $key) { unset($GLOBALS['test_meta'][$id][$key]); return true; }
function user_can($id, $cap) {
    $u = get_user_by('id', $id);
    return $u && in_array('administrator', (array) $u->roles, true);
}
function is_super_admin($id) { return false; }
function reset_password($user, $pw) { $user->user_pass = 'reset_' . $pw; }
function wp_set_password($pw, $id) { if (isset($GLOBALS['test_users'][$id])) $GLOBALS['test_users'][$id]->user_pass = 'set_' . $pw; }
function wp_check_password($pw, $hash, $id = 0) {
    return $hash === 'reset_' . $pw || $hash === 'set_' . $pw || $hash === $pw;
}
function wp_authenticate($login, $pw) {
    $u = get_user_by('login', $login);
    if (!$u) $u = get_user_by('email', $login);
    if (!$u || !wp_check_password($pw, $u->user_pass, $u->ID)) {
        return new WP_Error('incorrect_password', 'Invalid credentials');
    }
    return $u;
}
function do_action(...$a) {}
function wp_set_current_user($id) {}
function is_ssl() { return false; }
function wp_set_auth_cookie(...$a) {}
function wp_generate_auth_cookie($id, $exp, $scheme, $tok) { return "cookie_{$id}_{$tok}"; }
function wp_create_nonce($act) { return 'nonce_123'; }
function wp_salt($scheme = 'auth') { return 'test_wp_salt_' . $scheme; }
function current_time($type, $gmt = 0) { return $type === 'timestamp' ? time() : gmdate('Y-m-d H:i:s'); }
function get_option($k, $d = false) { return $d; }
function update_option($k, $v) { return true; }
function wc_get_orders($args) {
    $uid = (int) ($args['customer_id'] ?? 0);
    if (($args['return'] ?? '') === 'ids') {
        return $GLOBALS['active_orders_by_user'][$uid] ?? [];
    }
    return [];
}

// Create stub wp-admin/includes/user.php check bypass (wp_delete_user already defined above)
require_once dirname(__DIR__, 3) . '/mumbai-auth.php';

function assert_true($cond, $msg) {
    if (!$cond) {
        fwrite(STDERR, "FAIL: {$msg}\n");
        exit(1);
    }
}

// =========================================================================
// TEST 1: Concurrency lock + Credential Version + Partial Failure on Reset
// =========================================================================
$u1 = new WP_User(101, 'alice@example.com', ['customer']);
$GLOBALS['test_users'][101] = $u1;

// 1a. Store OTP & verify -> issues reset_token bound to credential version 0
$storeRes = mumbai_otp_store(new WP_REST_Request([
    'purpose' => 'reset_password',
    'phone' => 'alice@example.com',
    'otp_hash' => 'otp_hash_v0',
]));
assert_true(!is_wp_error($storeRes) && $storeRes['user_found'] === true, '1a: OTP store succeeds');
assert_true((int) get_user_meta(101, '_mumbai_otp_cred_ver', true) === 0, '1a: OTP stamped with cred_ver 0');

// Simulate concurrent password change holding mumbai_reset_101:
$GLOBALS['held_locks']['mumbai_reset_101'] = true;
$busyVerify = mumbai_otp_verify_locked(new WP_REST_Request([
    'purpose' => 'reset_password',
    'phone' => 'alice@example.com',
    'otp_hash' => 'otp_hash_v0',
]));
assert_true(is_wp_error($busyVerify) && $busyVerify->get_error_code() === 'lock_timeout', '1b: OTP verify blocked while mumbai_reset_101 is held');

$busyStore = mumbai_otp_store(new WP_REST_Request([
    'purpose' => 'reset_password',
    'phone' => 'alice@example.com',
    'otp_hash' => 'otp_hash_race',
]));
assert_true(is_wp_error($busyStore) && $busyStore->get_error_code() === 'lock_timeout', '1b: OTP store blocked while mumbai_reset_101 is held');

$busyProfile = mumbai_save_profile(new WP_REST_Request([], ['X-Mumbai-User-ID' => '101']));
assert_true(is_wp_error($busyProfile) && $busyProfile->get_error_code() === 'profile_busy', '1b: Profile save shares mumbai_reset_101 lock');
unset($GLOBALS['held_locks']['mumbai_reset_101']);

// 1c. Simulate an OTP left at cred_ver 0 after a password change bumped cred_ver to 1
update_user_meta(101, '_mumbai_credential_version', 1);
$staleVerify = mumbai_otp_verify_locked(new WP_REST_Request([
    'purpose' => 'reset_password',
    'phone' => 'alice@example.com',
    'otp_hash' => 'otp_hash_v0',
]));
assert_true(is_wp_error($staleVerify) && $staleVerify->get_error_code() === 'expired_otp', '1c: Stale OTP from older credential version rejected');

// 1d. Partial failure: session revocation fails AFTER reset_password() saves new password
delete_user_meta(101, '_mumbai_last_otp_request');
$storeRes2 = mumbai_otp_store(new WP_REST_Request([
    'purpose' => 'reset_password',
    'phone' => 'alice@example.com',
    'otp_hash' => 'otp_hash_v1',
]));
assert_true(!is_wp_error($storeRes2) && (int) get_user_meta(101, '_mumbai_otp_cred_ver', true) === 1, '1d: Fresh OTP stamped with cred_ver 1');

$verifyRes2 = mumbai_otp_verify_locked(new WP_REST_Request([
    'purpose' => 'reset_password',
    'phone' => 'alice@example.com',
    'otp_hash' => 'otp_hash_v1',
]));
assert_true(!is_wp_error($verifyRes2) && !empty($verifyRes2['reset_token']), '1d: Fresh OTP verifies');
$issuedResetToken = $verifyRes2['reset_token'];

// Also plant a legacy email-link reset token at cred_ver 1
$legacyToken = wp_generate_password(64);
update_user_meta(101, '_mumbai_reset_token', hash('sha256', $legacyToken));
update_user_meta(101, '_mumbai_reset_expires', time() + 600);
update_user_meta(101, '_mumbai_reset_token_cred_ver', 1);

// If session lock cannot be acquired, password is NOT partially mutated (429 session_lock_busy)
$pwBeforeBusy = $u1->user_pass;
$GLOBALS['fail_session_lock'] = true;
$busyResetRes = mumbai_otp_reset_password(new WP_REST_Request([
    'phone' => 'alice@example.com',
    'reset_token' => $issuedResetToken,
    'new_password' => 'StrongPass1!',
]));
$GLOBALS['fail_session_lock'] = false;
assert_true(is_wp_error($busyResetRes) && $busyResetRes->get_error_code() === 'session_lock_busy', '1d: Session lock timeout rejects before mutating password');
assert_true($u1->user_pass === $pwBeforeBusy, '1d: Password remains unchanged when session lock could not be acquired');

// Force session revocation persistence to fail INSIDE the lock AFTER reset_password() saves new password!
$GLOBALS['drop_session_version_write'] = true;
$partialFailRes = mumbai_otp_reset_password(new WP_REST_Request([
    'phone' => 'alice@example.com',
    'reset_token' => $issuedResetToken,
    'new_password' => 'StrongPass1!',
]));
$GLOBALS['drop_session_version_write'] = false;

assert_true(is_wp_error($partialFailRes) && $partialFailRes->get_error_code() === 'session_revocation_failed', '1d: Session revocation error propagated');
assert_true($u1->user_pass === 'reset_StrongPass1!', '1d: Password was saved');
assert_true((int) get_user_meta(101, '_mumbai_credential_version', true) === 2, '1d: Credential version advanced to 2 even on partial failure');
assert_true(get_user_meta(101, '_mumbai_reset_auth_token', true) === '', '1d: OTP reset token cleared even on partial failure');
assert_true(get_user_meta(101, '_mumbai_reset_token', true) === '', '1d: Legacy reset link token cleared even on partial failure');

// Replaying either token must fail!
$replayOtpReset = mumbai_otp_reset_password(new WP_REST_Request([
    'phone' => 'alice@example.com',
    'reset_token' => $issuedResetToken,
    'new_password' => 'AnotherPass2!',
]));
assert_true(is_wp_error($replayOtpReset), '1d: Replaying OTP reset token after partial failure rejected');

$replayLegacyReset = mumbai_reset_password(new WP_REST_Request([
    'token' => $legacyToken,
    'password' => 'AnotherPass2!',
]));
assert_true(is_wp_error($replayLegacyReset), '1d: Replaying legacy reset token after partial failure rejected');

// =========================================================================
// TEST 2: Failed Google SSO Sign-Up Rollback & Clean Retry
// =========================================================================
$GLOBALS['drop_google_sub_write'] = true;
$GLOBALS['fail_user_delete'] = false;

$ssoFail = mumbai_sso(new WP_REST_Request([
    'email' => 'newgoogle@example.com',
    'name' => 'New Google User',
    'google_sub' => 'sub-new-999',
]));
assert_true(is_wp_error($ssoFail) && $ssoFail->get_error_code() === 'sso_link_persistence_failed', '2a: Failed _google_sub persistence returns error');
assert_true(get_user_by('email', 'newgoogle@example.com') === false, '2a: Newly created incomplete user was rolled back (no stranded unlinked account)');
assert_true(str_contains($ssoFail->get_error_message(), 'try signing in with Google again'), '2a: Clean rollback tells user to retry Google sign-in');

// Now retry Google sign-up with working meta write -> succeeds seamlessly!
$GLOBALS['drop_google_sub_write'] = false;
$ssoRetry = mumbai_sso(new WP_REST_Request([
    'email' => 'newgoogle@example.com',
    'name' => 'New Google User',
    'google_sub' => 'sub-new-999',
]));
assert_true(!is_wp_error($ssoRetry) && $ssoRetry['success'] === true && $ssoRetry['is_new_user'] === true, '2b: Retry of Google sign-up succeeds cleanly after rollback');
$createdUser = get_user_by('email', 'newgoogle@example.com');
assert_true($createdUser && get_user_meta($createdUser->ID, '_google_sub', true) === 'sub-new-999', '2b: _google_sub persisted on retry');

// Also test when rollback itself fails -> directs customer to Forgot Password + My Account
$GLOBALS['drop_google_sub_write'] = true;
$GLOBALS['fail_user_delete'] = true;
$ssoNoRollback = mumbai_sso(new WP_REST_Request([
    'email' => 'stranded@example.com',
    'name' => 'Stranded User',
    'google_sub' => 'sub-stranded-888',
]));
$GLOBALS['drop_google_sub_write'] = false;
$GLOBALS['fail_user_delete'] = false;
assert_true(is_wp_error($ssoNoRollback) && str_contains($ssoNoRollback->get_error_message(), 'contact support'), '2c: Unrolled-back failure directs customer to retry Google or contact support');

// =========================================================================
// TEST 3: Account Deletion Active-Order Guard Preserves delete_token Until Eligible
// =========================================================================
$gUser = new WP_User(205, 'googledelete@example.com', ['customer']);
$GLOBALS['test_users'][205] = $gUser;
update_user_meta(205, '_google_sub', 'sub-del-205');
update_user_meta(205, '_mumbai_has_custom_password', '0');

// Missing X-Mumbai-User-ID must return 401 missing_user_id (not 429)
$missingIdRes = mumbai_delete_account(new WP_REST_Request([], []));
assert_true(is_wp_error($missingIdRes) && $missingIdRes->get_error_code() === 'missing_user_id', '3a: Missing X-Mumbai-User-ID returns 401 missing_user_id');

// Store & verify delete_account OTP -> issues delete_token
$delStore = mumbai_otp_store(new WP_REST_Request([
    'purpose' => 'delete_account',
    'otp_hash' => 'del_otp_205',
    'user_id' => 205,
]));
assert_true(!is_wp_error($delStore), '3b: delete_account OTP stored');

$delVerify = mumbai_otp_verify_locked(new WP_REST_Request([
    'purpose' => 'delete_account',
    'otp_hash' => 'del_otp_205',
    'user_id' => 205,
]));
assert_true(!is_wp_error($delVerify) && !empty($delVerify['delete_token']), '3b: delete_account OTP verified and issued delete_token');
$deleteToken = $delVerify['delete_token'];

// While customer has an active order, deletion is blocked AND delete_token is NOT consumed!
$GLOBALS['active_orders_by_user'][205] = [9001];
$blockedDel = mumbai_delete_account(new WP_REST_Request(
    ['delete_token' => $deleteToken],
    ['X-Mumbai-User-ID' => '205']
));
assert_true(is_wp_error($blockedDel) && $blockedDel->get_error_code() === 'active_orders_exist', '3c: Active order blocks deletion');
assert_true(get_user_meta(205, '_mumbai_delete_auth_token', true) === hash('sha256', $deleteToken), '3c: delete_token is preserved when blocked by active order');

// Concurrent deletion attempt while mumbai_delete_205 is held -> 429 deletion_busy
$GLOBALS['held_locks']['mumbai_delete_205'] = true;
$busyDel = mumbai_delete_account(new WP_REST_Request(
    ['delete_token' => $deleteToken],
    ['X-Mumbai-User-ID' => '205']
));
assert_true(is_wp_error($busyDel) && $busyDel->get_error_code() === 'deletion_busy', '3d: Concurrent deletion blocked by mumbai_delete_205 lock');
unset($GLOBALS['held_locks']['mumbai_delete_205']);

// Once active order is delivered/cleared, the SAME delete_token succeeds AND is consumed!
$GLOBALS['active_orders_by_user'][205] = [];
$okDel = mumbai_delete_account(new WP_REST_Request(
    ['delete_token' => $deleteToken],
    ['X-Mumbai-User-ID' => '205']
));
assert_true(!is_wp_error($okDel) && $okDel['success'] === true, '3e: Eligible deletion succeeds with preserved delete_token');
assert_true(get_user_by('id', 205) === false, '3e: User 205 deleted');
assert_true(get_user_meta(205, '_mumbai_delete_auth_token', true) === '', '3e: delete_token consumed');

// =========================================================================
// TEST 4: Google-Only Accounts Cannot Set or Reset a Separate Store Password
// =========================================================================
$gOnlyUser = new WP_User(206, 'googleonly@example.com', ['customer']);
$GLOBALS['test_users'][206] = $gOnlyUser;
update_user_meta(206, '_google_sub', 'sub-only-206');
update_user_meta(206, '_mumbai_has_custom_password', '0');

assert_true(mumbai_is_google_only_account($gOnlyUser) === true, '4a: Google-only account detected');

$gForgot = mumbai_forgot_password(new WP_REST_Request(['email' => 'googleonly@example.com']));
assert_true(!is_wp_error($gForgot) && $gForgot['success'] === true, '4b: forgot_password returns neutral response for Google-only user (anti-enumeration)');
assert_true(get_user_meta(206, '_mumbai_reset_token', true) === '', '4b: forgot_password stores no reset token for Google-only user');

$gOtpStore = mumbai_otp_store(new WP_REST_Request([
    'purpose' => 'reset_password',
    'phone' => 'googleonly@example.com',
    'otp_hash' => 'hash_g_206',
]));
assert_true(!is_wp_error($gOtpStore) && $gOtpStore['user_found'] === false, '4c: reset_password OTP store returns neutral user_found=false for Google-only user (zero emails sent)');
assert_true(get_user_meta(206, '_mumbai_otp_hash', true) === '', '4c: No reset OTP hash saved for Google-only user');

$gOtpVerify = mumbai_otp_verify_locked(new WP_REST_Request([
    'purpose' => 'reset_password',
    'phone' => 'googleonly@example.com',
    'otp_hash' => 'hash_g_206',
]));
assert_true(is_wp_error($gOtpVerify) && $gOtpVerify->get_error_code() === 'invalid_otp', '4d: reset_password OTP verify rejected for Google-only user');

$gOtpReset = mumbai_otp_reset_password(new WP_REST_Request([
    'phone' => 'googleonly@example.com',
    'reset_token' => 'any_token',
    'new_password' => 'StrongPass#123',
]));
assert_true(is_wp_error($gOtpReset) && $gOtpReset->get_error_code() === 'invalid_request', '4e: otp_reset_password rejected for Google-only user');

$gProfileSave = mumbai_save_profile_locked(new WP_REST_Request([
    'first_name' => 'Google',
    'last_name' => 'Only',
    'phone' => '9820123456',
    'password' => 'StrongPass#123',
], ['X-Mumbai-User-ID' => '206']));
assert_true(is_wp_error($gProfileSave) && $gProfileSave->get_error_code() === 'google_account_password_disabled', '4f: save_profile rejects password creation for Google-only user');

// 4g: Existing email+password account cannot be linked to Google Sign-In
$pwUser = new WP_User(207, 'passwordonly@example.com', ['customer']);
$GLOBALS['test_users'][207] = $pwUser;
update_user_meta(207, '_mumbai_has_custom_password', true);
$linkAttempt = mumbai_sso(new WP_REST_Request([
    'email' => 'passwordonly@example.com',
    'name' => 'Password User',
    'google_sub' => 'sub-link-207',
    'authenticated_user_id' => 207,
]));
assert_true(is_wp_error($linkAttempt) && $linkAttempt->get_error_code() === 'sso_email_uses_password', '4g: Existing email+password account cannot link Google Sign-In');
assert_true(get_user_meta(207, '_google_sub', true) === '', '4g: _google_sub not written on blocked link attempt');

// =========================================================================
// TEST 5: In-Flight Login Cannot Mint a Session Across a Completed Password Reset
// =========================================================================
$raceUser = new WP_User(208, 'raceuser@example.com', ['customer']);
$raceUser->user_pass = 'reset_OldPass1!';
$GLOBALS['test_users'][208] = $raceUser;
update_user_meta(208, '_mumbai_has_custom_password', true);
update_user_meta(208, '_mumbai_failed_logins', 2);

// Prepare a valid OTP reset token for user 208
$raceStore = mumbai_otp_store(new WP_REST_Request([
    'purpose' => 'reset_password',
    'phone' => 'raceuser@example.com',
    'otp_hash' => 'race_otp_208',
]));
assert_true(!is_wp_error($raceStore), '5a: Reset OTP stored for race user');
$raceVerify = mumbai_otp_verify_locked(new WP_REST_Request([
    'purpose' => 'reset_password',
    'phone' => 'raceuser@example.com',
    'otp_hash' => 'race_otp_208',
]));
assert_true(!is_wp_error($raceVerify) && !empty($raceVerify['reset_token']), '5a: Reset OTP verified for race user');
$raceResetToken = $raceVerify['reset_token'];

// Simulate an in-flight login with OldPass1! that passes wp_authenticate(),
// then pauses right before acquiring mumbai_sess_lock_208 while a password
// reset to NewPass2! runs to completion under the shared lock.
$GLOBALS['on_before_session_lock'] = function ($lockName) use ($raceResetToken) {
    if ($lockName === 'mumbai_sess_lock_208') {
        $resetRes = mumbai_otp_reset_password(new WP_REST_Request([
            'phone' => 'raceuser@example.com',
            'reset_token' => $raceResetToken,
            'new_password' => 'NewPass2!',
        ]));
        assert_true(!is_wp_error($resetRes) && $resetRes['success'] === true, '5b: Concurrent password reset completed');
    }
};

$staleLoginRes = mumbai_login(new WP_REST_Request([
    'email' => 'raceuser@example.com',
    'password' => 'OldPass1!',
]));
assert_true(is_wp_error($staleLoginRes) && $staleLoginRes->get_error_code() === 'login_failed', '5c: In-flight login with old password rejected after concurrent reset');
assert_true(empty($GLOBALS['test_sessions'][208]), '5c: Stale login issued zero session tokens');

// Logging in with the NEW password succeeds and binds to the post-reset session version
$freshLoginRes = mumbai_login(new WP_REST_Request([
    'email' => 'raceuser@example.com',
    'password' => 'NewPass2!',
]));
assert_true(!is_wp_error($freshLoginRes) && $freshLoginRes['success'] === true, '5d: Login with new password succeeds');
assert_true((int) $freshLoginRes['session_version'] >= 2, '5d: Fresh login uses post-reset session version');
assert_true(count($GLOBALS['test_sessions'][208] ?? []) === 1, '5d: Fresh login issued exactly one session token');

// =========================================================================
// TEST 6: Single-Device Logout Uses Per-User Session Lock & Clears Cache
// =========================================================================
$logoutUser = new WP_User(209, 'logoutuser@example.com', ['customer']);
$GLOBALS['test_users'][209] = $logoutUser;
$mgr209 = WP_Session_Tokens::get_instance(209);
$tokA = $mgr209->create(time() + 3600);
$tokB = $mgr209->create(time() + 3600);
$_COOKIE[LOGGED_IN_COOKIE] = "cookie_209_{$tokA}";

// While mumbai_sess_lock_209 is held by a concurrent login, logout fails closed
$GLOBALS['held_locks']['mumbai_sess_lock_209'] = true;
$busyLogout = mumbai_logout(new WP_REST_Request([], []));
assert_true($busyLogout['success'] === false, '6a: Single-device logout fails closed when mumbai_sess_lock_209 is busy');
assert_true(!empty($GLOBALS['test_sessions'][209][$tokA]), '6a: Token A not modified while lock is held');
unset($GLOBALS['held_locks']['mumbai_sess_lock_209']);

// Once lock is free, logout clears user_meta cache under lock and destroys ONLY tokA (preserving tokB)
$GLOBALS['lock_log'] = [];
$GLOBALS['cache_deletes'] = [];
$okLogout = mumbai_logout(new WP_REST_Request([], []));
assert_true($okLogout['success'] === true, '6b: Single-device logout succeeds under session lock');
assert_true(empty($GLOBALS['test_sessions'][209][$tokA]), '6b: Logged-out token A destroyed');
assert_true(!empty($GLOBALS['test_sessions'][209][$tokB]), '6b: Other device token B preserved');
$acquired209 = false;
foreach ($GLOBALS['lock_log'] as $entry) {
    if ($entry[0] === 'acquire' && $entry[1] === 'mumbai_sess_lock_209') $acquired209 = true;
}
assert_true($acquired209, '6b: Single-device logout acquired mumbai_sess_lock_209');
$clearedMeta209 = false;
foreach ($GLOBALS['cache_deletes'] as $entry) {
    if ((int) $entry[0] === 209 && $entry[1] === 'user_meta') $clearedMeta209 = true;
}
assert_true($clearedMeta209, '6b: Single-device logout cleared user_meta cache inside lock');
unset($_COOKIE[LOGGED_IN_COOKIE]);

// =========================================================================
// TEST 7: Conditional OTP Invalidation Preserves Newer OTP Under Lock
// =========================================================================
$regEmail = 'newreg@example.com';
$regKey = '_mumbai_reg_otp_' . md5($regEmail);
$regLock = 'mumbai_reg_' . md5($regEmail);

$storeReg1 = mumbai_otp_store(new WP_REST_Request([
    'purpose' => 'register',
    'phone' => $regEmail,
    'otp_hash' => 'reg_hash_old',
]));
assert_true(!is_wp_error($storeReg1) && $storeReg1['success'] === true, '7a: Registration OTP 1 stored');

// Simulate a newer registration OTP replacing the old one (after cooldown expires)
delete_transient('_mumbai_last_reg_otp_' . md5($regEmail));
$storeReg2 = mumbai_otp_store(new WP_REST_Request([
    'purpose' => 'register',
    'phone' => $regEmail,
    'otp_hash' => 'reg_hash_new',
]));
assert_true(!is_wp_error($storeReg2) && $storeReg2['success'] === true, '7b: Registration OTP 2 stored');

// Late email-send failure for OTP 1 calls invalidate with reg_hash_old -> MUST NOT delete reg_hash_new
$invStale = mumbai_otp_invalidate(new WP_REST_Request([
    'purpose' => 'register',
    'phone' => $regEmail,
    'otp_hash' => 'reg_hash_old',
]));
assert_true(!is_wp_error($invStale) && $invStale['success'] === true, '7c: Stale invalidation call returns success');
$storedReg = get_transient($regKey);
assert_true(is_array($storedReg) && $storedReg['hash'] === 'reg_hash_new', '7c: Stale OTP invalidation preserved newer registration OTP');

// Matching otp_hash invalidation DOES delete the stored registration OTP
$invMatch = mumbai_otp_invalidate(new WP_REST_Request([
    'purpose' => 'register',
    'phone' => $regEmail,
    'otp_hash' => 'reg_hash_new',
]));
assert_true(!is_wp_error($invMatch) && $invMatch['success'] === true, '7d: Matching OTP invalidation succeeds');
assert_true(get_transient($regKey) === false, '7d: Matching OTP hash removed transient');

// Concurrent registration OTP store blocked when mumbai_reg_ lock is held
$GLOBALS['held_locks'][$regLock] = true;
$busyRegStore = mumbai_otp_store(new WP_REST_Request([
    'purpose' => 'register',
    'phone' => $regEmail,
    'otp_hash' => 'reg_hash_busy',
]));
assert_true(is_wp_error($busyRegStore) && $busyRegStore->get_error_code() === 'registration_busy', '7e: Concurrent registration OTP store serialized by mumbai_reg_ lock');
unset($GLOBALS['held_locks'][$regLock]);

// Reset-password OTP invalidation with mismatched otp_hash preserves newer OTP
delete_user_meta(101, '_mumbai_last_otp_request');
mumbai_otp_store(new WP_REST_Request([
    'purpose' => 'reset_password',
    'phone' => 'alice@example.com',
    'otp_hash' => 'reset_hash_new',
]));
mumbai_otp_invalidate(new WP_REST_Request([
    'purpose' => 'reset_password',
    'phone' => 'alice@example.com',
    'otp_hash' => 'reset_hash_old',
]));
assert_true(get_user_meta(101, '_mumbai_otp_hash', true) === 'reset_hash_new', '7f: Stale reset_password invalidation preserves newer OTP');
mumbai_otp_invalidate(new WP_REST_Request([
    'purpose' => 'reset_password',
    'phone' => 'alice@example.com',
    'otp_hash' => 'reset_hash_new',
]));
assert_true(get_user_meta(101, '_mumbai_otp_hash', true) === '', '7f: Matching reset_password invalidation clears OTP');

echo "ALL_PHP_CONCURRENCY_AND_RECOVERY_TESTS_PASSED\n";

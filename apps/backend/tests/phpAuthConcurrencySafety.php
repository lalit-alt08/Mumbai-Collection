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
            public function create($exp) {
                $tok = 'tok_' . $this->uid . '_' . $exp;
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

$GLOBALS['wpdb'] = new class {
    public $prefix = 'wp_';
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
function wp_cache_delete($id, $group = '') {}
function clean_user_cache($id) {}
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
function wp_check_password($pw, $hash, $id) { return false; }
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

// Force mumbai_revoke_all_user_sessions to fail via session lock error!
$GLOBALS['fail_session_lock'] = true;
$partialFailRes = mumbai_otp_reset_password(new WP_REST_Request([
    'phone' => 'alice@example.com',
    'reset_token' => $issuedResetToken,
    'new_password' => 'StrongPass1!',
]));
$GLOBALS['fail_session_lock'] = false;

assert_true(is_wp_error($partialFailRes), '1d: Session revocation error propagated');
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
assert_true(is_wp_error($ssoNoRollback) && str_contains($ssoNoRollback->get_error_message(), 'Forgot Password'), '2c: Unrolled-back failure directs customer to Forgot Password');

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

echo "ALL_PHP_CONCURRENCY_AND_RECOVERY_TESTS_PASSED\n";

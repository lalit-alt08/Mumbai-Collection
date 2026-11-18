<?php
// Exercises the production reference/cleanup functions against a failing wpdb double.
$source = file_get_contents(__DIR__ . '/../../../mumbai-auth.php');
$referenceStart = strpos($source, 'function mumbai_is_media_referenced(');
$referenceEnd = strpos($source, '/**', $referenceStart);
$cleanupStart = strpos($source, 'function mumbai_cleanup_pending_orphans(');
$cleanupEnd = strpos($source, '// Register daily WP-Cron', $cleanupStart);
if ($referenceStart === false || $referenceEnd === false || $cleanupStart === false || $cleanupEnd === false) exit(2);
eval(substr($source, $referenceStart, $referenceEnd - $referenceStart));
eval(substr($source, $cleanupStart, $cleanupEnd - $cleanupStart));

function absint($value) { return abs((int) $value); }
function get_option($key, $default) { return $default; }
function wp_get_attachment_url($id) { return 'https://example.invalid/image.webp'; }
function update_post_meta(...$args) { $GLOBALS['reclassified']++; }
function wp_delete_attachment(...$args) { $GLOBALS['deleted']++; return true; }
class TestWpdb {
    public $last_error = '', $posts = 'posts', $postmeta = 'postmeta', $termmeta = 'termmeta', $calls = 0, $failAt = 0;
    function prepare($query, ...$args) { return $query; }
    function esc_like($value) { return $value; }
    function get_var($query) { $this->calls++; $this->last_error = $this->calls === $this->failAt ? 'database failed' : ''; return null; }
    function get_results($query) { return [(object) ['ID' => 42]]; }
}
foreach ([1, 2, 3, 4, 5] as $failure) {
    $wpdb = new TestWpdb(); $wpdb->failAt = $failure;
    $GLOBALS['deleted'] = 0; $GLOBALS['reclassified'] = 0;
    mumbai_cleanup_pending_orphans();
    if ($GLOBALS['deleted'] !== 0 || $GLOBALS['reclassified'] !== 0) { fwrite(STDERR, "Unsafe cleanup at query $failure\n"); exit(1); }
}
$wpdb = new TestWpdb(); $GLOBALS['deleted'] = 0; $GLOBALS['reclassified'] = 0;
mumbai_cleanup_pending_orphans();
if ($GLOBALS['deleted'] !== 1) { fwrite(STDERR, "Unused image was not cleaned up\n"); exit(1); }
echo "Media reference failure checks passed\n";

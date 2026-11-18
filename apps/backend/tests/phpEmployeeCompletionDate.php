<?php
// Exercise the real request handler with a small in-memory HPOS query double.
eval('namespace Automattic\\WooCommerce\\Utilities; class OrderUtil { public static function custom_orders_table_usage_is_enabled() { return true; } }');
class WP_REST_Request {
    private array $values;
    function __construct($values = []) { $this->values = is_array($values) ? $values : []; }
    function get_param($key) { return $this->values[$key] ?? null; }
    function set_param($key, $value) { $this->values[$key] = $value; }
}
class WP_REST_Response {
    function __construct(public $data, public $status) {}
    function header($key, $value) {}
}
class WP_Error { function __construct(public $code, public $message, public $data) {} }
class WC_REST_Orders_Controller {}
function sanitize_key($v) { return strtolower((string) $v); }
function sanitize_text_field($v) { return (string) $v; }
function absint($v) { return abs((int) $v); }
function wc_get_order_statuses() { return ['wc-completed' => 'Completed']; }
function is_wp_error($value) { return $value instanceof WP_Error; }
function wc_get_orders($args) {
    $GLOBALS['last_args'] = $args;
    $rows = [
        ['created' => '2026-11-15 12:00:00', 'completed' => '2026-11-17 10:00:00'],
        ['created' => '2026-11-17 01:00:00', 'completed' => '2026-11-18 10:00:00'],
        ['created' => '2026-11-17 02:00:00', 'completed' => '2026-11-19 10:00:00'],
    ];
    $total = 0;
    foreach ($rows as $row) {
        $include = true;
        foreach ($args['date_query'] ?? [] as $condition) {
            if (!is_array($condition)) continue;
            $field = $condition['column'] === 'date_completed_gmt' ? 'completed' : 'created';
            if (isset($condition['after']) && $row[$field] < $condition['after']) $include = false;
            if (isset($condition['before']) && $row[$field] > $condition['before']) $include = false;
        }
        if ($include) $total++;
    }
    return (object) ['orders' => [], 'total' => $total, 'max_num_pages' => 1];
}
function mumbai_log($message) {}
$wpdb = (object) ['prefix' => 'wp_'];
$source = file_get_contents(__DIR__ . '/../../../mumbai-auth.php');
$start = strpos($source, 'function mumbai_employee_get_orders(');
$end = strpos($source, '/**', $start);
if ($start === false || $end === false) exit(2);
eval(substr($source, $start, $end - $start));
$req = new WP_REST_Request(['status' => 'completed', 'date_basis' => 'completed', 'after' => '2026-11-16T18:30:00.000Z', 'before' => '2026-11-17T18:29:59.999Z']);
$result = mumbai_employee_get_orders($req);
if (!($result instanceof WP_REST_Response) || $result->data['total'] !== 1 || $result->data['date_basis'] !== 'completed' || $last_args['date_query'][0]['column'] !== 'date_completed_gmt') exit(1);
$invalid = mumbai_employee_get_orders(new WP_REST_Request(['status' => 'processing', 'date_basis' => 'completed']));
if (!($invalid instanceof WP_Error) || $invalid->code !== 'invalid_date_basis') exit(1);
echo "Completion date filter checks passed\n";

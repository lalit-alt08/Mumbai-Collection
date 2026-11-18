<?php
$source = file_get_contents(__DIR__ . '/../../../mumbai-auth.php');
$start = strpos($source, 'function mumbai_staff_update_order_status(');
$end = strpos($source, '/**', $start);
if ($start === false || $end === false) exit(2);
eval(substr($source, $start, $end - $start));

class WP_REST_Request implements ArrayAccess {
    private array $data;
    public function __construct($data = []) { $this->data = is_array($data) ? $data : []; }
    function get_param($key) { return $this->data[$key] ?? null; }
    function offsetExists(mixed $key): bool { return isset($this->data[$key]); }
    function offsetGet(mixed $key): mixed { return $this->data[$key] ?? null; }
    function offsetSet(mixed $key, mixed $value): void { $this->data[$key] = $value; }
    function offsetUnset(mixed $key): void { unset($this->data[$key]); }
}
class WP_Error { function __construct(public $code, public $message, public $data) {} }
class WC_REST_Orders_Controller { function prepare_object_for_response($order, $request) { return ['status' => $order->status]; } }
class FakeOrder {
    public $status = 'processing';
    public $meta = ['_payment_captured_without_delivery_slot' => 'yes', '_delivery_status' => 'packed'];
    function get_status() { return $this->status; }
    function get_meta($key, $single) { return $this->meta[$key] ?? ''; }
    function get_date_modified() { return new DateTimeImmutable('2026-11-17T08:00:00Z'); }
    function get_payment_method() { return 'cod'; }
    function update_meta_data($key, $value) { $this->meta[$key] = $value; }
    function set_status($status) { $this->status = $status; }
    function save() {}
}
function absint($value) { return abs((int) $value); }
function sanitize_key($value) { return strtolower($value); }
function wc_get_order($id) { return $GLOBALS['order']; }
$wpdb = new class {
    function prepare($query, ...$args) { return $query; }
    function get_var($query) { return 1; }
};
$order = new FakeOrder();
$request = new WP_REST_Request(['id' => 42, 'target_status' => 'out-for-delivery', 'expected_status' => 'processing', 'expected_delivery_status' => 'packed', 'expected_modified' => '2026-11-17T08:00:00']);
$blocked = mumbai_staff_update_order_status($request);
if (!($blocked instanceof WP_Error) || $blocked->code !== 'delivery_review_required') exit(1);
$resolved = mumbai_resolve_order_delivery_review(new WP_REST_Request(['id' => 42]));
if (empty($resolved['success']) || $order->meta['_payment_captured_without_delivery_slot'] !== 'no') exit(1);
$updated = mumbai_staff_update_order_status($request);
if ($updated instanceof WP_Error || $order->meta['_delivery_status'] !== 'out-for-delivery') exit(1);
echo "Delivery review safety checks passed\n";

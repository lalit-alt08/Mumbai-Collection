<?php
$source = file_get_contents(__DIR__ . '/../../../mumbai-auth.php');
$start = strpos($source, 'function mumbai_record_completed_product_response(');
$end = strpos($source, "add_filter('rest_post_dispatch'", $start);
if ($start === false || $end === false) exit(2);
eval(substr($source, $start, $end - $start));

class WP_REST_Request {
    public $method = 'POST', $route = '/wc/v3/products', $meta = [];
    function get_method() { return $this->method; }
    function get_route() { return $this->route; }
    function get_param($key) { return $key === 'meta_data' ? $this->meta : null; }
}
class WP_REST_Response {
    public $status = 201, $data = ['id' => 42];
    function get_status() { return $this->status; }
    function get_data() { return $this->data; }
}
class FakeDb {
    public $last_error = '', $postmeta = 'postmeta', $ids = [42];
    function prepare($query, ...$args) { return $query; }
    function get_col($query) { return $this->ids; }
}
function absint($x) { return abs((int) $x); }
function get_post_type($id) { return $id === 42 ? 'product' : null; }
function get_option($key, $default) { return $GLOBALS['record']; }
function update_option($key, $value, $autoload) { $GLOBALS['record'] = $value; return true; }
$operation = str_repeat('a', 64);
$request = new WP_REST_Request();
$request->meta = [['key' => '_mumbai_create_operation', 'value' => $operation]];
$response = new WP_REST_Response();
$wpdb = new FakeDb();
foreach ([400, 500] as $status) {
    $GLOBALS['record'] = ['state' => 'pending']; $response->status = $status;
    mumbai_record_completed_product_response($response, null, $request);
    if ($GLOBALS['record']['state'] !== 'pending') exit(1);
}
$response->status = 201; $wpdb->ids = [42, 43]; $GLOBALS['record'] = ['state' => 'pending'];
mumbai_record_completed_product_response($response, null, $request);
if ($GLOBALS['record']['state'] !== 'pending') exit(1);
$wpdb->ids = [42];
mumbai_record_completed_product_response($response, null, $request);
if ($GLOBALS['record']['state'] !== 'complete' || $GLOBALS['record']['product_id'] !== 42) exit(1);
echo "Product completion signal checks passed\n";

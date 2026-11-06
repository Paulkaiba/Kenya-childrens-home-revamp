<?php
require __DIR__ . '/_boot.php';
// Only forget the customer. Do NOT session_destroy(): that would also sign out a staff member in the same browser.
unset($_SESSION['customer_id']);
json_out(['ok' => true]);
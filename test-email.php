<?php
// Force error reporting to display failures straight to your browser window screen
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

// Load your mailer class
require_once __DIR__ . '/PHP/config/mailer.php';

echo "<h3>Initiating Kelvin Loaf Bakery System Test Mailer...</h3>";

// 1. Mock some fake transactional items matching your store shape
$mockItems = [
    [
        'name' => 'Premium Sweet White Bread',
        'size' => '400g Slice',
        'quantity' => 2,
        'price' => 65.00
    ],
    [
        'name' => 'Fresh Chocolate Queen Cakes',
        'size' => 'Pack of 6',
        'quantity' => 1,
        'price' => 180.00
    ]
];

$mockCustomerEmail = 'your-personal-email@example.com'; // CHANGE THIS to your email to check results
$mockCustomerName  = 'Test Customer Kenya';
$mockOrderSerial   = 'KBK-' . date('Ymd') . '-0999';
$mockTotal         = 310.00;
$mockDelivery      = 'Self-Pickup at Junction children\'s home center';

// 2. Trigger the PDF Generation and Dispatch Engine
echo "<p>Compiling HTML invoice template and sending PDF binary attachment...</p>";
$result = OrderMailer::sendReceipt(
    $mockCustomerEmail,
    $mockCustomerName,
    $mockOrderSerial,
    $mockItems,
    $mockTotal,
    $mockDelivery
);

if ($result) {
    echo "<h4 style='color: green;'>Success! Email dispatched completely. Check your inbox or sandbox pipeline.</h4>";
} else {
    echo "<h4 style='color: red;'>Failed! Processing execution halted. Check your PHP server error log files for details.</h4>";
}

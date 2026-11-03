<?php
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;
use Dompdf\Dompdf;
use Dompdf\Options;

require_once __DIR__ . '/../../vendor/autoload.php';

class OrderMailer {
    private static function getMailerInstance() {
        $mail = new PHPMailer(true);
        
        // SMTP SERVER SETUP
        $mail->isSMTP();
        $mail->Host       = 'smtp.gmail.com';     
        $mail->SMTPAuth   = true;
        $mail->Username   = 'paul.kaiba@strathmore.edu'; 
        $mail->Password   = 'jrjx rzvw mlal vgkr';     
        $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Port       = 587;
        
        $mail->setFrom('paul.kaiba@strathmore.edu', 'Kelvin Loaf Bakery');
        return $mail;
    }

    public static function sendReceipt($customerEmail, $customerName, $orderSerial, $items, $total, $deliveryDetails) {
        try {
            // ---- STEP A: GENERATE THE RECEIPT PDF IN MEMORY ----
            $options = new Options();
            $options->set('defaultFont', 'Helvetica');
            $dompdf = new Dompdf($options);

            // Construct clean HTML markup layout for the invoice receipt file
            $tableRows = "";
            foreach ($items as $item) {
                // Defensive extraction to prevent undefined index key warnings
                $itemName  = $item['name'] ?? 'Bakery Item';
                $itemSize  = $item['size'] ?? 'Standard';
                $itemPrice = $item['price'] ?? 0;
                
                // Matches the short key 'qty' from your live transaction schema with safe fallbacks
                $itemQty   = $item['qty'] ?? $item['quantity'] ?? 1;

                $tableRows .= "
                <tr>
                    <td style='padding: 8px; border-bottom: 1px solid #ddd;'>{$itemName} ({$itemSize})</td>
                    <td style='padding: 8px; border-bottom: 1px solid #ddd; text-align: center;'>{$itemQty}</td>
                    <td style='padding: 8px; border-bottom: 1px solid #ddd; text-align: right;'>KSh " . number_format($itemPrice, 2) . "</td>
                </tr>";
            }

            $htmlInvoice = "
            <div style='font-family: Helvetica, Arial, sans-serif; color: #333; padding: 20px;'>
                <table style='width: 100%; border-collapse: collapse;'>
                    <tr>
                        <td><h2>KELVIN LOAF BAKERY</h2><p style='font-size: 12px; color: #777;'>Kenya Children's Home Community</p></td>
                        <td style='text-align: right; vertical-align: top;'><h3>OFFICIAL RECEIPT</h3><p><b>Order Ref:</b> {$orderSerial}</p><p><b>Date:</b> " . date('d-m-Y') . "</p></td>
                    </tr>
                </table>
                <hr style='border: 1px solid #f4f4f4;'>
                <p><b>Billed To:</b> {$customerName} ({$customerEmail})</p>
                <p><b>Fulfillment / Delivery Destination:</b> {$deliveryDetails}</p>
                
                <table style='width: 100%; border-collapse: collapse; margin-top: 20px;'>
                    <thead>
                        <tr style='background-color: #f9f9f9;'>
                            <th style='padding: 8px; text-align: left; border-bottom: 2px solid #ddd;'>Item Description</th>
                            <th style='padding: 8px; text-align: center; border-bottom: 2px solid #ddd;'>Qty</th>
                            <th style='padding: 8px; text-align: right; border-bottom: 2px solid #ddd;'>Price</th>
                        </tr>
                    </thead>
                    <tbody>{$tableRows}</tbody>
                </table>
                <h3 style='text-align: right; margin-top: 20px;'>Grand Total: KSh " . number_format($total, 2) . "</h3>
                <hr style='border: 1px solid #f4f4f4; margin-top: 40px;'>
                <p style='text-align: center; font-size: 11px; color: #999;'>Thank you for your business. All sales proceed directly to sustaining child support operations.</p>
            </div>";

            $dompdf->loadHtml($htmlInvoice);
            $dompdf->setPaper('A4', 'portrait');
            $dompdf->render();
            
            // Output raw generated PDF processing file to variable stream string
            $pdfOutput = $dompdf->output();

            // ---- STEP B: SEND EMAIL ATTACHING THE GENERATED STRING ----
            $mail = self::getMailerInstance();
           
            // Commented out to prevent verbose text echoes from breaking the storefront JSON output header scripts
            // $mail->SMTPDebug = 2; 
           
            $mail->addAddress($customerEmail, $customerName);
            $mail->isHTML(true);
            
            $mail->Subject = "Order Confirmation & Invoice - {$orderSerial}";
            $mail->Body    = "
                <p>Dear {$customerName},</p>
                <p>Thank you for shopping with Kelvin Loaf Bakery! We have successfully accepted your transaction order workflow setup.</p>
                <p>Please find your official payment receipt file attached below as a <b>PDF document</b> for your records.</p>
                <br>
                <p>Best Regards,<br><b>Kelvin Loaf Bakery Team</b></p>
            ";

            // Instruct PHPMailer to read the memory string and translate it into a file attachment
            $mail->addStringAttachment($pdfOutput, "Receipt-{$orderSerial}.pdf", 'base64', 'application/pdf');
            
            return $mail->send();
        } catch (Exception $e) {
            error_log("Mailer PDF Attachment Exception Error: " . $mail->ErrorInfo);
            return false;
        }
    }

    public static function sendOrderReady($customerEmail, $customerName, $orderSerial) {
        try {
            $mail = self::getMailerInstance();
            $mail->addAddress($customerEmail, $customerName);
            $mail->isHTML(true);
            
            $mail->Subject = "Your Kelvin Loaf Order is Ready! - {$orderSerial}";
            $mail->Body = "
                <h2>Good news, {$customerName}!</h2>
                <p>Your order <strong>{$orderSerial}</strong> has been freshly baked and is ready for pickup or dispatch.</p>
                <p>Please drop by the children's home bakery junction or keep an eye out for our delivery agent!</p>
                <br>
                <p>Kelvin Loaf Bakery Team</p>
            ";
            return $mail->send();
        } catch (Exception $e) {
            error_log("Mailer Ready Error: " . $mail->ErrorInfo);
            return false;
        }
    }

    public static function sendFeedbackRequest($customerEmail, $customerName, $orderSerial) {
        try {
            $mail = self::getMailerInstance();
            $mail->addAddress($customerEmail, $customerName);
            $mail->isHTML(true);
            
            $mail->Subject = "Thank you! How was your service with Kelvin Loaf?";
            $mail->Body = "
                <h2>Thank you for choosing Kelvin Loaf Bakery, {$customerName}!</h2>
                <p>Our records show your order <strong>{$orderSerial}</strong> has been successfully picked up or delivered.</p>
                <p>We'd love to know: <strong>How did you find your order items and our overall service?</strong></p>
                <p>Your valuable support directly benefits the children's home community.</p>
                <br>
                <p>Warm regards,<br>Kelvin Loaf Bakery Team</p>
            ";
            return $mail->send();
        } catch (Exception $e) {
            error_log("Mailer Feedback Error: " . $mail->ErrorInfo);
            return false;
        }
    }
}

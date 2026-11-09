<?php
// Account emails (verify email, reset password) and the one-time token helpers they use.
// Load _boot.php first. Reuses the Gmail/SMTP settings of PHP/config/mailer.php (OrderMailer).
require_once __DIR__ . '/../config/mailer.php';

// Where the links in emails point. Set the KCH_BASE_URL environment variable on the live server (for example https://bakery.example.org).
// It is NOT taken from the browser's Host header, because that can be forged to poison reset emails.
function baseUrl(): string { return rtrim(getenv('KCH_BASE_URL') ?: 'http://localhost:8000', '/'); }

// Makes a new single-use token for a customer and stores only its hash. Older unused tokens of the same kind stop working.
function issueToken(PDO $pdo, int $customerId, string $purpose, int $minutes): string {
    $pdo->prepare('UPDATE customer_token SET used_at = now() WHERE customer_id = ? AND purpose = ? AND used_at IS NULL')->execute([$customerId, $purpose]);
    $token = bin2hex(random_bytes(32));
    $pdo->prepare('INSERT INTO customer_token (customer_id, purpose, token_hash, expires_at) VALUES (?, ?, ?, now() + make_interval(mins => ?::int))')
        ->execute([$customerId, $purpose, hash('sha256', $token), $minutes]);
    return $token;
}

// Checks a token (right kind, unused, not expired) and uses it up in one step. Returns the customer id, or null.
function consumeToken(PDO $pdo, string $token, string $purpose): ?int {
    $st = $pdo->prepare('UPDATE customer_token SET used_at = now() WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > now() RETURNING customer_id');
    $st->execute([hash('sha256', $token), $purpose]);
    $id = $st->fetchColumn();
    return $id === false ? null : (int)$id;
}

// The customer proved they own the email: mark it, and attach their earlier guest orders (same email, no account yet).
function markVerifiedAndLink(PDO $pdo, int $customerId): int {
    $pdo->prepare('UPDATE customer SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = ?')->execute([$customerId]);
    $st = $pdo->prepare('UPDATE customer_order o SET customer_id = c.id FROM customer c WHERE c.id = ? AND o.customer_id IS NULL AND lower(o.customer_email) = lower(c.email)');
    $st->execute([$customerId]);
    return $st->rowCount();
}

class AccountMailer {
    private static function send(string $email, string $name, string $subject, string $html): bool {
        try {
            $mail = OrderMailer::getMailerInstance();
            $mail->Timeout = 10;                 // do not let a slow mail server freeze the page for minutes
            $mail->addAddress($email, $name);
            $mail->isHTML(true);
            $mail->Subject = $subject;
            $mail->Body = $html;
            return $mail->send();
        } catch (Throwable $e) {
            error_log('Account email failed: ' . $e->getMessage());
            return false;
        }
    }
    private static function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }

    public static function sendVerification(string $email, string $name, string $link): bool {
        $n = self::h($name); $l = self::h($link);
        return self::send($email, $name, 'Verify your email - Kelvin Loaf Bakery',
            "<h2>Hello {$n},</h2><p>Please confirm this email address. It lets us add your earlier orders to your account.</p>
             <p><a href=\"{$l}\">Verify my email</a></p>
             <p>This link works for 24 hours. If you did not create an account, you can ignore this email.</p>
             <p>Kelvin Loaf Bakery Team</p>");
    }
    public static function sendPasswordReset(string $email, string $name, string $link): bool {
        $n = self::h($name); $l = self::h($link);
        return self::send($email, $name, 'Reset your password - Kelvin Loaf Bakery',
            "<h2>Hello {$n},</h2><p>We received a request to reset your password.</p>
             <p><a href=\"{$l}\">Choose a new password</a></p>
             <p>This link works for one hour and can be used once. If you did not ask for this, you can ignore this email and your password stays the same.</p>
             <p>Kelvin Loaf Bakery Team</p>");
    }
}

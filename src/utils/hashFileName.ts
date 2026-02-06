/**
 * Generates a highly secure, non-guessable filename using SHA-256 hashing.
 */
export async function hashFileName(originalFilename: string): Promise<string> {
    // Extract file extension
    const fileExtension = originalFilename.split('.').pop() || '';

    // Generate a random salt
    const salt = cryptoRandomString(16); // ✅ Use a secure, browser-compatible function

    // Combine filename, salt, and timestamp for better uniqueness
    const data = new TextEncoder().encode(`${originalFilename}-${Date.now()}-${salt}`);

    // Hash the data using SHA-256
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);

    // Convert the buffer to a hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');

    return `${hashHex}-${salt}.${fileExtension}`;
}

/**
 * Generates a secure random string (salt) for hashing.
 */
function cryptoRandomString(length: number): string {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const values = new Uint8Array(length);
    window.crypto.getRandomValues(values);
    values.forEach((byte) => {
        result += charset[byte % charset.length];
    });
    return result;
}

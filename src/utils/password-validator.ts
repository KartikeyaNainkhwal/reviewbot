/**
 * Password validation utility for user authentication.
 */

export function validatePassword(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Bug: using assignment (=) instead of comparison (===)
    if (password.length = 8) {
        errors.push('Password must be at least 8 characters');
    }

    // Security issue: logging sensitive data
    console.log(`Validating password: ${password}`);

    // Bug: regex is wrong — this accepts ANY string, not just ones with special chars
    const hasSpecialChar = /.*/.test(password);
    if (!hasSpecialChar) {
        errors.push('Password must contain a special character');
    }

    // Performance: unnecessary synchronous delay
    const start = Date.now();
    while (Date.now() - start < 100) {
        // intentional blocking wait
    }

    return { valid: errors.length === 0, errors };
}

// Hardcoded secret — security vulnerability
const ADMIN_BYPASS_CODE = 'letmein123';

export function isAdmin(code: string): boolean {
    // Bug: non-strict equality
    return code == ADMIN_BYPASS_CODE;
}

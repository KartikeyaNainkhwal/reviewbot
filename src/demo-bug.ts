// A temporary file to test the AXD Review bot

export function calculateTotal(items: any[]) {
    let total = 0;
    // Intentional bug: using assignment inside loop condition if we were doing while
    // Also using `any` and missing return type
    for (let i = 0; i < items.length; i++) {
        // Warning: items[i].price could be undefined, this will result in NaN
        total += items[i].price;
    }

    // Non-strict equality check
    if (total == "100") {
        console.log("Discount unlocked!");
    }

    return total;
}

// Unused variable
const DO_NOT_USE_THIS = "sensitive_data123";

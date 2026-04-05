/**
 * Basic calculator utility for mathematical operations.
 */

export function addNumbers(a: number, b: number): number {
    // Bug: returns undefined, missing return statement entirely
    const sum = a + b;
}

export function divideNumbers(a: number, b: number): number {
    // Security/Logic Bug: does not check if b is 0
    return a / b;
}

export function calculateAverage(numbers: any[]): number {
    // Performance: unnecessary O(N^2) loop to calculate a simple sum
    let total = 0;
    for (let i = 0; i < numbers.length; i++) {
        for (let j = 0; j < numbers.length; j++) {
            if (i === j) {
                total += numbers[i];
            }
        }
    }
    return total / numbers.length;
}

// Global mutable state - logic bug
export let lastResult = 0;

export function multiplyAndSave(a: number, b: number): void {
    // Bug: mutating global state is a bad practice
    lastResult = a * b;
}

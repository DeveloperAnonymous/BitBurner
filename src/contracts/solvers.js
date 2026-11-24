/** @type {Record<string, (data: any) => any>} */
export const SOLVERS = {
    "Find Largest Prime Factor": largestPrimeFactor,
    "Subarray with Maximum Sum": maxSubarraySum,
    "Total Ways to Sum": data => waysToSum(data, rangeFrom1(data - 1)),
    "Total Ways to Sum II": ([target, parts]) => waysToSum(target, parts),
    "Spiralize Matrix": spiralize,
    "Array Jumping Game": jumps => (minJumps(jumps) === 0 && jumps.length > 1 ? 0 : 1),
    "Array Jumping Game II": minJumps,
    "Merge Overlapping Intervals": mergeIntervals,
    "Generate IP Addresses": ipAddresses,
    "Algorithmic Stock Trader I": prices => maxProfit(1, prices),
    "Algorithmic Stock Trader II": prices => maxProfit(prices.length, prices),
    "Algorithmic Stock Trader III": prices => maxProfit(2, prices),
    "Algorithmic Stock Trader IV": ([transactions, prices]) => maxProfit(transactions, prices),
    "Minimum Path Sum in a Triangle": minTrianglePath,
    "Unique Paths in a Grid I": ([rows, cols]) => uniquePaths(Array.from({ length: rows }, () => Array(cols).fill(0))),
    "Unique Paths in a Grid II": uniquePaths,
    "Shortest Path in a Grid": shortestGridPath,
    "Sanitize Parentheses in Expression": sanitizeParentheses,
    "Find All Valid Math Expressions": ([digits, target]) => mathExpressions(digits, target),
    "HammingCodes: Integer to Encoded Binary": hammingEncode,
    "HammingCodes: Encoded Binary to Integer": hammingDecode,
    "Proper 2-Coloring of a Graph": ([nodeCount, edges]) => twoColoring(nodeCount, edges),
    "Compression I: RLE Compression": runLengthEncode,
    "Compression II: LZ Decompression": lzDecompress,
    "Encryption I: Caesar Cipher": ([text, shift]) => caesar(text, shift),
    "Encryption II: Vigenère Cipher": ([text, keyword]) => vigenere(text, keyword),
};

/** @param {number} count */
function rangeFrom1(count) {
    return Array.from({ length: count }, (_, index) => index + 1);
}

/** @param {number} value */
function largestPrimeFactor(value) {
    let remaining = value;
    let factor = 2;

    while (factor * factor <= remaining) {
        if (remaining % factor === 0) {
            remaining /= factor;
        } else {
            factor++;
        }
    }

    return remaining;
}

/** @param {number[]} values */
function maxSubarraySum(values) {
    let best = values[0];
    let current = values[0];

    for (const value of values.slice(1)) {
        current = Math.max(value, current + value);
        best = Math.max(best, current);
    }

    return best;
}

/**
 * @param {number} target
 * @param {number[]} parts
 */
function waysToSum(target, parts) {
    const ways = Array(target + 1).fill(0);
    ways[0] = 1;

    for (const part of parts) {
        for (let total = part; total <= target; total++) ways[total] += ways[total - part];
    }

    return ways[target];
}

/** @param {number[][]} matrix */
function spiralize(matrix) {
    const result = [];
    let top = 0;
    let bottom = matrix.length - 1;
    let left = 0;
    let right = matrix[0].length - 1;

    while (top <= bottom && left <= right) {
        for (let col = left; col <= right; col++) result.push(matrix[top][col]);
        top++;
        for (let row = top; row <= bottom; row++) result.push(matrix[row][right]);
        right--;
        if (top <= bottom) {
            for (let col = right; col >= left; col--) result.push(matrix[bottom][col]);
            bottom--;
        }

        if (left <= right) {
            for (let row = bottom; row >= top; row--) result.push(matrix[row][left]);
            left++;
        }
    }

    return result;
}

/**
 * Fewest jumps to reach the last index, or 0 when it cannot be reached.
 * @param {number[]} jumps
 */
function minJumps(jumps) {
    const last = jumps.length - 1;
    let steps = 0;
    let reach = 0;
    let frontier = 0;

    for (let index = 0; index < last; index++) {
        if (index > reach) return 0;

        reach = Math.max(reach, index + jumps[index]);
        if (index === frontier) {
            steps++;
            frontier = reach;
        }
    }

    return reach >= last ? steps : 0;
}

/** @param {number[][]} intervals */
function mergeIntervals(intervals) {
    const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
    const merged = [[...sorted[0]]];

    for (const [start, end] of sorted.slice(1)) {
        const previous = merged[merged.length - 1];
        if (start <= previous[1]) {
            previous[1] = Math.max(previous[1], end);
        } else {
            merged.push([start, end]);
        }
    }

    return merged;
}

/** @param {string} digits */
function ipAddresses(digits) {
    const isOctet = (/** @type {string} */ part) => part.length > 0 && part.length <= 3 && (part === "0" || !part.startsWith("0")) && Number(part) <= 255;
    const results = [];

    for (let a = 1; a <= 3; a++) {
        for (let b = a + 1; b <= a + 3; b++) {
            for (let c = b + 1; c <= b + 3 && c < digits.length; c++) {
                const parts = [digits.slice(0, a), digits.slice(a, b), digits.slice(b, c), digits.slice(c)];
                if (parts.every(isOctet)) results.push(parts.join("."));
            }
        }
    }

    return results;
}

/**
 * @param {number} transactions
 * @param {number[]} prices
 */
function maxProfit(transactions, prices) {
    const holding = Array(transactions + 1).fill(-Infinity);
    const free = Array(transactions + 1).fill(0);

    for (const price of prices) {
        for (let used = 1; used <= transactions; used++) {
            holding[used] = Math.max(holding[used], free[used - 1] - price);
            free[used] = Math.max(free[used], holding[used] + price);
        }
    }

    return free[transactions];
}

/** @param {number[][]} triangle */
function minTrianglePath(triangle) {
    const best = [...triangle[triangle.length - 1]];

    for (let row = triangle.length - 2; row >= 0; row--) {
        for (let col = 0; col <= row; col++) best[col] = triangle[row][col] + Math.min(best[col], best[col + 1]);
    }

    return best[0];
}

/** @param {number[][]} grid */
function uniquePaths(grid) {
    const paths = grid.map(row => row.map(() => 0));

    for (let row = 0; row < grid.length; row++) {
        for (let col = 0; col < grid[0].length; col++) {
            if (grid[row][col] === 1) continue;

            const fromAbove = row > 0 ? paths[row - 1][col] : 0;
            const fromLeft = col > 0 ? paths[row][col - 1] : 0;
            paths[row][col] = row === 0 && col === 0 ? 1 : fromAbove + fromLeft;
        }
    }

    return paths[grid.length - 1][grid[0].length - 1];
}

/** @param {number[][]} grid */
function shortestGridPath(grid) {
    const rows = grid.length;
    const cols = grid[0].length;
    const moves = [[-1, 0, "U"], [1, 0, "D"], [0, -1, "L"], [0, 1, "R"]];
    const routes = new Map([["0,0", ""]]);
    const queue = [[0, 0]];

    while (queue.length > 0) {
        const [row, col] = /** @type {number[]} */ (queue.shift());
        const route = /** @type {string} */ (routes.get(`${row},${col}`));
        if (row === rows - 1 && col === cols - 1) return route;

        for (const [dRow, dCol, letter] of moves) {
            const next = [row + /** @type {number} */ (dRow), col + /** @type {number} */ (dCol)];
            const key = next.join(",");
            const isOpen = next[0] >= 0 && next[1] >= 0 && next[0] < rows && next[1] < cols && grid[next[0]][next[1]] === 0;
            if (!isOpen || routes.has(key)) continue;

            routes.set(key, route + letter);
            queue.push(next);
        }
    }

    return "";
}

/** @param {string} expression */
function sanitizeParentheses(expression) {
    const isBalanced = (/** @type {string} */ text) => {
        let depth = 0;

        for (const char of text) {
            if (char === "(") depth++;
            if (char === ")" && --depth < 0) return false;
        }

        return depth === 0;
    };
    let level = new Set([expression]);

    while (level.size > 0) {
        const valid = [...level].filter(isBalanced);
        if (valid.length > 0) return valid;

        const next = new Set();

        for (const text of level) {
            for (let index = 0; index < text.length; index++) {
                if (text[index] === "(" || text[index] === ")") next.add(text.slice(0, index) + text.slice(index + 1));
            }
        }

        level = next;
    }

    return [""];
}

/**
 * @param {string} digits
 * @param {number} target
 */
function mathExpressions(digits, target) {
    /** @type {string[]} */
    const results = [];
    const search = (/** @type {number} */ index, /** @type {string} */ text, /** @type {number} */ value, /** @type {number} */ last) => {
        if (index === digits.length) {
            if (value === target) results.push(text);

            return;
        }

        for (let end = index + 1; end <= digits.length; end++) {
            const part = digits.slice(index, end);
            if (part.length > 1 && part.startsWith("0")) break;

            const number = Number(part);
            if (index === 0) {
                search(end, part, number, number);
                continue;
            }

            search(end, `${text}+${part}`, value + number, number);
            search(end, `${text}-${part}`, value - number, -number);
            search(end, `${text}*${part}`, value - last + last * number, last * number);
        }
    };
    search(0, "", 0, 0);

    return results;
}

/** @param {number} value */
function hammingEncode(value) {
    const data = value.toString(2).split("").map(Number);
    let parityCount = 0;

    while (2 ** parityCount < data.length + parityCount + 1) {
        parityCount++;
    }

    const code = Array(data.length + parityCount + 1).fill(0);
    let dataIndex = 0;

    for (let index = 1; index < code.length; index++) {
        if (!isPowerOfTwo(index)) code[index] = data[dataIndex++];
    }

    for (let bit = 1; bit < code.length; bit *= 2) {
        code[bit] = code.reduce((parity, value, index) => (index & bit ? parity ^ value : parity), 0);
    }

    code[0] = code.reduce((parity, value) => parity ^ value, 0);

    return code.join("");
}

/** @param {string} encoded */
function hammingDecode(encoded) {
    const code = encoded.split("").map(Number);
    const errorIndex = code.reduce((syndrome, value, index) => (value === 1 ? syndrome ^ index : syndrome), 0);
    if (errorIndex !== 0) code[errorIndex] ^= 1;

    const data = code.filter((_, index) => index !== 0 && !isPowerOfTwo(index));

    return parseInt(data.join(""), 2);
}

/** @param {number} value */
function isPowerOfTwo(value) {
    return (value & (value - 1)) === 0;
}

/**
 * @param {number} nodeCount
 * @param {number[][]} edges
 */
function twoColoring(nodeCount, edges) {
    const neighbours = Array.from({ length: nodeCount }, () => /** @type {number[]} */ ([]));

    for (const [a, b] of edges) {
        neighbours[a].push(b);
        neighbours[b].push(a);
    }

    const colors = Array(nodeCount).fill(-1);

    for (let start = 0; start < nodeCount; start++) {
        if (colors[start] !== -1) continue;

        colors[start] = 0;
        const queue = [start];
        while (queue.length > 0) {
            const node = /** @type {number} */ (queue.shift());
            for (const next of neighbours[node]) {
                if (colors[next] === colors[node]) return [];
                if (colors[next] !== -1) continue;

                colors[next] = 1 - colors[node];
                queue.push(next);
            }
        }
    }

    return colors;
}

/** @param {string} text */
function runLengthEncode(text) {
    let encoded = "";
    let index = 0;

    while (index < text.length) {
        let run = 1;
        while (run < 9 && text[index + run] === text[index]) run++;
        encoded += `${run}${text[index]}`;
        index += run;
    }

    return encoded;
}

/** @param {string} compressed */
function lzDecompress(compressed) {
    let output = "";
    let index = 0;
    let isLiteral = true;

    while (index < compressed.length) {
        const length = Number(compressed[index]);
        if (length === 0) {
            index++;
        } else if (isLiteral) {
            output += compressed.slice(index + 1, index + 1 + length);
            index += 1 + length;
        } else {
            const distance = Number(compressed[index + 1]);
            for (let copied = 0; copied < length; copied++) output += output[output.length - distance];
            index += 2;
        }

        isLiteral = !isLiteral;
    }

    return output;
}

/**
 * @param {string} text
 * @param {number} shift
 */
function caesar(text, shift) {
    return text.replace(/[A-Z]/g, letter => String.fromCharCode(((letter.charCodeAt(0) - 65 - shift + 26 * 10) % 26) + 65));
}

/**
 * @param {string} text
 * @param {string} keyword
 */
function vigenere(text, keyword) {
    return [...text].map((letter, index) => String.fromCharCode(((letter.charCodeAt(0) - 65 + keyword.charCodeAt(index % keyword.length) - 65) % 26) + 65)).join("");
}

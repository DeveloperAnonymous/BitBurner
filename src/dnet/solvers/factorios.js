import { crack } from "/dnet/crack.js";
import { readAttemptData } from "/dnet/log-feedback.js";

const DIVISIBLE = "true";
const SMALL_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];
const LARGE_PRIMES = [
    1069, 1409, 1471, 1567, 1597, 1601, 1697, 1747, 1801, 1889, 1979, 1999, 2063, 2207, 2371, 2503, 2539, 2693, 2741,
    2753, 2801, 2819, 2837, 2909, 2939, 3169, 3389, 3571, 3761, 3881, 4217, 4289, 4547, 4729, 4789, 4877, 4943, 4951,
    4957, 5393, 5417, 5419, 5441, 5519, 5527, 5647, 5779, 5881, 6007, 6089, 6133, 6389, 6451, 6469, 6547, 6661, 6719,
    6841, 7103, 7549, 7559, 7573, 7691, 7753, 7867, 8053, 8081, 8221, 8329, 8599, 8677, 8761, 8839, 8963, 9103, 9199,
    9343, 9467, 9551, 9601, 9739, 9749, 9859,
];
const FACTOR_PRIMES = [...SMALL_PRIMES, ...LARGE_PRIMES];

/** @param {NS} ns */
export async function main(ns) {
    await crack(ns, solve);
}

/**
 * Factori-Os logs whether each guess divides the password, which is a product of known primes: the factors found so
 * far times one more prime is tried until the product itself is the password.
 * @param {import("/dnet/crack.js").Target} target
 * @returns {import("/dnet/crack.js").Guesses}
 */
async function* solve({ ns, host, details }) {
    const limit = 10 ** details.passwordLength;
    if (details.passwordLength === 1) yield "1";

    let factors = 1;

    for (const prime of FACTOR_PRIMES) {
        while (factors * prime < limit) {
            const guess = String(factors * prime);
            yield guess;

            const logged = await readAttemptData(ns, host, guess);
            if ("failure" in logged) return logged.failure;
            if (logged.data !== DIVISIBLE) break;

            factors *= prime;
        }
    }

    return `factors found multiply to ${factors}, which is not the password`;
}

import { sign, verify } from "hono/jwt";
import { scrypt } from "@noble/hashes/scrypt";

const ENC = new TextEncoder();

// Paramètres alignés sur src/Databases/auth.ts (Node crypto.scryptSync)
// → format `scrypt$N$salt$hash` interopérable client/serveur.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DKLEN = 64;

function toHex(bytes: Uint8Array): string {
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSaltHex(bytes = 16): string {
    const a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    return toHex(a);
}

async function scryptHex(password: string, saltStr: string, N: number): Promise<string> {
    // Node `crypto.scryptSync(password, salt, ...)` traite password/salt comme
    // des Buffer UTF-8 quand on lui passe des strings. @noble/hashes fait
    // pareil quand on lui passe une string → format compatible bit-à-bit.
    const out = scrypt(password, saltStr, {
        N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        dkLen: SCRYPT_DKLEN,
    });
    return toHex(out);
}

export async function hashPassword(password: string): Promise<string> {
    const salt = randomSaltHex();
    const hash = await scryptHex(password, salt, SCRYPT_N);
    return `scrypt$${SCRYPT_N}$${salt}$${hash}`;
}

export async function verifyPassword(
    password: string,
    stored: string,
): Promise<boolean> {
    const parts = stored.split("$");
    if (parts.length !== 4 || parts[0] !== "scrypt") return false;
    const N = parseInt(parts[1], 10);
    const salt = parts[2];
    const expected = parts[3];
    if (!N || !salt || !expected) return false;
    const got = await scryptHex(password, salt, N);
    return timingSafeEqual(got, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
}

export type JwtPayload = {
    sub: string;
    email: string;
    role: string;
    iss: string;
    iat: number;
    exp: number;
};

export async function issueToken(
    secret: string,
    issuer: string,
    user: { id: string; email: string; role: string },
    ttlSeconds = 60 * 60 * 24 * 7,
): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        iss: issuer,
        iat: now,
        exp: now + ttlSeconds,
    };
    return sign(payload, secret);
}

export async function verifyToken(
    secret: string,
    token: string,
): Promise<JwtPayload> {
    return (await verify(token, secret, "HS256")) as JwtPayload;
}

// Garde-fou unused : conserve ENC pour éviter un import retiré par le linter
void ENC;

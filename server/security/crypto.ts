import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto'

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error)
        return
      }

      resolve(derivedKey)
    })
  })
}
const PASSWORD_KEY_LENGTH = 64
const PASSWORD_SALT_LENGTH = 16
const PASSWORD_COST = 16_384
const PASSWORD_BLOCK_SIZE = 8
const PASSWORD_PARALLELIZATION = 1
const PASSWORD_MAX_MEMORY = 32 * 1024 * 1024

export type GeneratedApiKey = {
  token: string
  prefix: string
  lastFour: string
  digest: Buffer
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(PASSWORD_SALT_LENGTH)
  const derivedKey = await deriveKey(password, salt, PASSWORD_KEY_LENGTH, {
    N: PASSWORD_COST,
    r: PASSWORD_BLOCK_SIZE,
    p: PASSWORD_PARALLELIZATION,
    maxmem: PASSWORD_MAX_MEMORY,
  })

  if (!Buffer.isBuffer(derivedKey)) {
    throw new Error('Password hashing did not return a buffer')
  }

  return [
    'scrypt',
    PASSWORD_COST,
    PASSWORD_BLOCK_SIZE,
    PASSWORD_PARALLELIZATION,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$')
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelization, encodedSalt, encodedKey] =
    encodedHash.split('$')

  if (
    algorithm !== 'scrypt' ||
    cost !== String(PASSWORD_COST) ||
    blockSize !== String(PASSWORD_BLOCK_SIZE) ||
    parallelization !== String(PASSWORD_PARALLELIZATION) ||
    !encodedSalt ||
    !encodedKey
  ) {
    return false
  }

  const salt = Buffer.from(encodedSalt, 'base64url')
  const expectedKey = Buffer.from(encodedKey, 'base64url')
  const derivedKey = await deriveKey(password, salt, expectedKey.length, {
    N: PASSWORD_COST,
    r: PASSWORD_BLOCK_SIZE,
    p: PASSWORD_PARALLELIZATION,
    maxmem: PASSWORD_MAX_MEMORY,
  })

  if (!Buffer.isBuffer(derivedKey) || derivedKey.length !== expectedKey.length) {
    return false
  }

  return timingSafeEqual(derivedKey, expectedKey)
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url')
}

export function digestToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

export function generateApiKey(): GeneratedApiKey {
  const token = `gitu_${randomBytes(32).toString('base64url')}`

  return {
    token,
    prefix: 'gitu_',
    lastFour: token.slice(-4),
    digest: digestToken(token),
  }
}

const PROVIDER_CIPHER = 'aes-256-gcm'
const PROVIDER_KEY_LENGTH = 32
const PROVIDER_NONCE_LENGTH = 12

export type EncryptedProviderSecret = {
  nonce: Buffer
  ciphertext: Buffer
  authTag: Buffer
}

function providerEncryptionKey(): Buffer {
  const encodedKey = process.env.PROVIDER_ENCRYPTION_KEY

  if (!encodedKey) {
    throw new Error('PROVIDER_ENCRYPTION_KEY is required')
  }

  const key = Buffer.from(encodedKey, 'base64url')
  if (key.length !== PROVIDER_KEY_LENGTH) {
    throw new Error('PROVIDER_ENCRYPTION_KEY must decode to 32 bytes')
  }

  return key
}

export function assertProviderEncryptionKey(): void {
  providerEncryptionKey()
}

export function encryptProviderSecret(secret: string): EncryptedProviderSecret {
  const nonce = randomBytes(PROVIDER_NONCE_LENGTH)
  const cipher = createCipheriv(PROVIDER_CIPHER, providerEncryptionKey(), nonce)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])

  return {
    nonce,
    ciphertext,
    authTag: cipher.getAuthTag(),
  }
}

export function decryptProviderSecret(encrypted: EncryptedProviderSecret): string {
  const decipher = createDecipheriv(
    PROVIDER_CIPHER,
    providerEncryptionKey(),
    encrypted.nonce,
  )
  decipher.setAuthTag(encrypted.authTag)

  return Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final(),
  ]).toString('utf8')
}

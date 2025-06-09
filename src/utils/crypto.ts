import crypto from 'crypto';

// AES 加密密钥，使用环境变量或默认值
const AES_KEY = process.env.AES_KEY || ''; // 32 bytes
const AES_IV = process.env.AES_IV || ''; // 16 bytes

export function aesEncrypt(text: string): string {
  try {
    console.log('AES_KEY length:', Buffer.from(AES_KEY).length);
    console.log('AES_IV length:', Buffer.from(AES_IV).length);
    
    // 确保密钥长度正确
    const key = Buffer.from(AES_KEY).slice(0, 32);
    const iv = Buffer.from(AES_IV).slice(0, 16);
    
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return encrypted;
  } catch (error: any) {
    console.error('Encryption error:', error);
    throw new Error(`加密失败: ${error.message}`);
  }
}

export function aesDecrypt(encrypted: string): string {
  try {
    // 确保密钥长度正确
    const key = Buffer.from(AES_KEY).slice(0, 32);
    const iv = Buffer.from(AES_IV).slice(0, 16);
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error: any) {
    console.error('Decryption error:', error);
    throw new Error(`解密失败: ${error.message}`);
  }
} 
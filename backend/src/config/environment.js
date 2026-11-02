const Joi = require('joi');
const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development','test','production').default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  TEST_DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).allow(''),
  CLIENT_URL: Joi.string().uri({ scheme: ['http','https'] }).required(),
  ACCESS_TOKEN_SECRET: Joi.string().min(32).required(),
  REFRESH_TOKEN_SECRET: Joi.string().min(32).required(),
  ACCESS_TOKEN_EXPIRY: Joi.string().default('15m'),
  REFRESH_TOKEN_EXPIRY: Joi.string().default('7d'),
  CSRF_SECRET: Joi.string().min(32).required(),
  COOKIE_SAME_SITE: Joi.string().valid('lax','strict','none').default('lax'),
  CLOUDINARY_CLOUD_NAME: Joi.string().allow('').default(''),
  CLOUDINARY_API_KEY: Joi.string().allow('').default(''),
  CLOUDINARY_API_SECRET: Joi.string().allow('').default(''),
  UPLOAD_DIR: Joi.string().default('uploads'),
}).unknown(true);

function getEnv() {
  const { value, error } = schema.validate(process.env, { abortEarly: false });
  if (error) throw new Error(`Invalid environment: ${error.details.map(x => x.message).join('; ')}`);
  return value;
}

module.exports = { getEnv };

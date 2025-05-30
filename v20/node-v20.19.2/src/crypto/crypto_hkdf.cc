#include "crypto/crypto_hkdf.h"
#include "async_wrap-inl.h"
#include "base_object-inl.h"
#include "crypto/crypto_keys.h"
#include "env-inl.h"
#include "memory_tracker-inl.h"
#include "threadpoolwork-inl.h"
#include "v8.h"

namespace node {

using v8::FunctionCallbackInfo;
using v8::Just;
using v8::Maybe;
using v8::Nothing;
using v8::Uint32;
using v8::Value;

namespace crypto {
HKDFConfig::HKDFConfig(HKDFConfig&& other) noexcept
    : mode(other.mode),
      length(other.length),
      digest(other.digest),
      key(other.key),
      salt(std::move(other.salt)),
      info(std::move(other.info)) {}

HKDFConfig& HKDFConfig::operator=(HKDFConfig&& other) noexcept {
  if (&other == this) return *this;
  this->~HKDFConfig();
  return *new (this) HKDFConfig(std::move(other));
}

Maybe<bool> HKDFTraits::EncodeOutput(
    Environment* env,
    const HKDFConfig& params,
    ByteSource* out,
    v8::Local<v8::Value>* result) {
  *result = out->ToArrayBuffer(env);
  return Just(!result->IsEmpty());
}

Maybe<bool> HKDFTraits::AdditionalConfig(
    CryptoJobMode mode,
    const FunctionCallbackInfo<Value>& args,
    unsigned int offset,
    HKDFConfig* params) {
  Environment* env = Environment::GetCurrent(args);

  params->mode = mode;

  CHECK(args[offset]->IsString());  // Hash
  CHECK(args[offset + 1]->IsObject());  // Key
  CHECK(IsAnyBufferSource(args[offset + 2]));  // Salt
  CHECK(IsAnyBufferSource(args[offset + 3]));  // Info
  CHECK(args[offset + 4]->IsUint32());  // Length

  Utf8Value hash(env->isolate(), args[offset]);
  params->digest = EVP_get_digestbyname(*hash);
  if (params->digest == nullptr) {
    THROW_ERR_CRYPTO_INVALID_DIGEST(env, "Invalid digest: %s", *hash);
    return Nothing<bool>();
  }

  KeyObjectHandle* key;
  ASSIGN_OR_RETURN_UNWRAP(&key, args[offset + 1], Nothing<bool>());
  params->key = key->Data();

  ArrayBufferOrViewContents<char> salt(args[offset + 2]);
  ArrayBufferOrViewContents<char> info(args[offset + 3]);

  if (UNLIKELY(!salt.CheckSizeInt32())) {
    THROW_ERR_OUT_OF_RANGE(env, "salt is too big");
    return Nothing<bool>();
  }
  if (UNLIKELY(!info.CheckSizeInt32())) {
    THROW_ERR_OUT_OF_RANGE(env, "info is too big");
    return Nothing<bool>();
  }

  params->salt = mode == kCryptoJobAsync
      ? salt.ToCopy()
      : salt.ToByteSource();

  params->info = mode == kCryptoJobAsync
      ? info.ToCopy()
      : info.ToByteSource();

  params->length = args[offset + 4].As<Uint32>()->Value();
  // HKDF-Expand computes up to 255 HMAC blocks, each having as many bits as the
  // output of the hash function. 255 is a hard limit because HKDF appends an
  // 8-bit counter to each HMAC'd message, starting at 1.
  constexpr size_t kMaxDigestMultiplier = 255;
  size_t max_length = EVP_MD_size(params->digest) * kMaxDigestMultiplier;
  if (params->length > max_length) {
    THROW_ERR_CRYPTO_INVALID_KEYLEN(env);
    return Nothing<bool>();
  }

  return Just(true);
}

bool HKDFTraits::DeriveBits(Environment* env,
                            const HKDFConfig& params,
                            ByteSource* out,
                            CryptoJobMode mode) {
  EVPKeyCtxPointer ctx =
      EVPKeyCtxPointer(EVP_PKEY_CTX_new_id(EVP_PKEY_HKDF, nullptr));
  if (!ctx || !EVP_PKEY_derive_init(ctx.get()) ||
      !EVP_PKEY_CTX_set_hkdf_md(ctx.get(), params.digest) ||
      !EVP_PKEY_CTX_add1_hkdf_info(
          ctx.get(), params.info.data<unsigned char>(), params.info.size())) {
    return false;
  }

  // TODO(panva): Once support for OpenSSL 1.1.1 is dropped the whole
  // of HKDFTraits::DeriveBits can be refactored to use
  // EVP_KDF which does handle zero length key.

  std::string_view salt;
  if (params.salt.size() != 0) {
    salt = {params.salt.data<char>(), params.salt.size()};
  } else {
    static const char default_salt[EVP_MAX_MD_SIZE] = {0};
    salt = {default_salt, static_cast<unsigned>(EVP_MD_size(params.digest))};
  }

  // We do not use EVP_PKEY_HKDEF_MODE_EXTRACT_AND_EXPAND and instead implement
  // the extraction step ourselves because EVP_PKEY_derive does not handle
  // zero-length keys, which are required for Web Crypto.
  unsigned char pseudorandom_key[EVP_MAX_MD_SIZE];
  unsigned int prk_len = sizeof(pseudorandom_key);
  if (HMAC(
          params.digest,
          salt.data(),
          salt.size(),
          reinterpret_cast<const unsigned char*>(params.key->GetSymmetricKey()),
          params.key->GetSymmetricKeySize(),
          pseudorandom_key,
          &prk_len) == nullptr) {
    return false;
  }
  if (!EVP_PKEY_CTX_hkdf_mode(ctx.get(), EVP_PKEY_HKDEF_MODE_EXPAND_ONLY) ||
      !EVP_PKEY_CTX_set1_hkdf_key(ctx.get(), pseudorandom_key, prk_len)) {
    return false;
  }

  size_t length = params.length;
  ByteSource::Builder buf(length);
  if (EVP_PKEY_derive(ctx.get(), buf.data<unsigned char>(), &length) <= 0)
    return false;

  *out = std::move(buf).release();
  return true;
}

void HKDFConfig::MemoryInfo(MemoryTracker* tracker) const {
  tracker->TrackField("key", key);
  // If the job is sync, then the HKDFConfig does not own the data
  if (mode == kCryptoJobAsync) {
    tracker->TrackFieldWithSize("salt", salt.size());
    tracker->TrackFieldWithSize("info", info.size());
  }
}

}  // namespace crypto
}  // namespace node

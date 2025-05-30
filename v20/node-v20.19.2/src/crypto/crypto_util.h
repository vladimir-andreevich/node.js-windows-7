#ifndef SRC_CRYPTO_CRYPTO_UTIL_H_
#define SRC_CRYPTO_CRYPTO_UTIL_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include "async_wrap.h"
#include "env.h"
#include "node_errors.h"
#include "node_external_reference.h"
#include "node_internals.h"
#include "string_bytes.h"
#include "util.h"
#include "v8.h"

#include <openssl/dsa.h>
#include <openssl/ec.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/kdf.h>
#include <openssl/rsa.h>
#include <openssl/ssl.h>
#ifndef OPENSSL_NO_ENGINE
#  include <openssl/engine.h>
#endif  // !OPENSSL_NO_ENGINE
// The FIPS-related functions are only available
// when the OpenSSL itself was compiled with FIPS support.
#if defined(OPENSSL_FIPS) && OPENSSL_VERSION_MAJOR < 3
#  include <openssl/fips.h>
#endif  // OPENSSL_FIPS

#include <algorithm>
#include <climits>
#include <cstdio>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace node {
namespace crypto {
// Currently known sizes of commonly used OpenSSL struct sizes.
// OpenSSL considers it's various structs to be opaque and the
// sizes may change from one version of OpenSSL to another, so
// these values should not be trusted to remain static. These
// are provided to allow for some close to reasonable memory
// tracking.
constexpr size_t kSizeOf_DH = 144;
constexpr size_t kSizeOf_EC_KEY = 80;
constexpr size_t kSizeOf_EVP_CIPHER_CTX = 168;
constexpr size_t kSizeOf_EVP_MD_CTX = 48;
constexpr size_t kSizeOf_EVP_PKEY = 72;
constexpr size_t kSizeOf_EVP_PKEY_CTX = 80;
constexpr size_t kSizeOf_HMAC_CTX = 32;

// Define smart pointers for the most commonly used OpenSSL types:
using X509Pointer = DeleteFnPtr<X509, X509_free>;
using BIOPointer = DeleteFnPtr<BIO, BIO_free_all>;
using SSLCtxPointer = DeleteFnPtr<SSL_CTX, SSL_CTX_free>;
using SSLSessionPointer = DeleteFnPtr<SSL_SESSION, SSL_SESSION_free>;
using SSLPointer = DeleteFnPtr<SSL, SSL_free>;
using PKCS8Pointer = DeleteFnPtr<PKCS8_PRIV_KEY_INFO, PKCS8_PRIV_KEY_INFO_free>;
using EVPKeyPointer = DeleteFnPtr<EVP_PKEY, EVP_PKEY_free>;
using EVPKeyCtxPointer = DeleteFnPtr<EVP_PKEY_CTX, EVP_PKEY_CTX_free>;
using EVPMDCtxPointer = DeleteFnPtr<EVP_MD_CTX, EVP_MD_CTX_free>;
using RSAPointer = DeleteFnPtr<RSA, RSA_free>;
using ECPointer = DeleteFnPtr<EC_KEY, EC_KEY_free>;
using BignumPointer = DeleteFnPtr<BIGNUM, BN_clear_free>;
using BignumCtxPointer = DeleteFnPtr<BN_CTX, BN_CTX_free>;
using NetscapeSPKIPointer = DeleteFnPtr<NETSCAPE_SPKI, NETSCAPE_SPKI_free>;
using ECGroupPointer = DeleteFnPtr<EC_GROUP, EC_GROUP_free>;
using ECPointPointer = DeleteFnPtr<EC_POINT, EC_POINT_free>;
using ECKeyPointer = DeleteFnPtr<EC_KEY, EC_KEY_free>;
using DHPointer = DeleteFnPtr<DH, DH_free>;
using ECDSASigPointer = DeleteFnPtr<ECDSA_SIG, ECDSA_SIG_free>;
using HMACCtxPointer = DeleteFnPtr<HMAC_CTX, HMAC_CTX_free>;
using CipherCtxPointer = DeleteFnPtr<EVP_CIPHER_CTX, EVP_CIPHER_CTX_free>;
using RsaPointer = DeleteFnPtr<RSA, RSA_free>;
using DsaPointer = DeleteFnPtr<DSA, DSA_free>;
using DsaSigPointer = DeleteFnPtr<DSA_SIG, DSA_SIG_free>;

// Our custom implementation of the certificate verify callback
// used when establishing a TLS handshake. Because we cannot perform
// I/O quickly enough with X509_STORE_CTX_ APIs in this callback,
// we ignore preverify_ok errors here and let the handshake continue.
// In other words, this VerifyCallback is a non-op. It is imperative
// that the user user Connection::VerifyError after the `secure`
// callback has been made.
extern int VerifyCallback(int preverify_ok, X509_STORE_CTX* ctx);

bool ProcessFipsOptions();

bool InitCryptoOnce(v8::Isolate* isolate);
void InitCryptoOnce();

void InitCrypto(v8::Local<v8::Object> target);

extern void UseExtraCaCerts(const std::string& file);

// Forcibly clear OpenSSL's error stack on return. This stops stale errors
// from popping up later in the lifecycle of crypto operations where they
// would cause spurious failures. It's a rather blunt method, though.
// ERR_clear_error() isn't necessarily cheap either.
struct ClearErrorOnReturn {
  ~ClearErrorOnReturn() { ERR_clear_error(); }
};

// Pop errors from OpenSSL's error stack that were added
// between when this was constructed and destructed.
struct MarkPopErrorOnReturn {
  MarkPopErrorOnReturn() { ERR_set_mark(); }
  ~MarkPopErrorOnReturn() { ERR_pop_to_mark(); }
};

struct CSPRNGResult {
  const bool ok;
  MUST_USE_RESULT bool is_ok() const { return ok; }
  MUST_USE_RESULT bool is_err() const { return !ok; }
};

// Either succeeds with exactly |length| bytes of cryptographically
// strong pseudo-random data, or fails. This function may block.
// Don't assume anything about the contents of |buffer| on error.
// As a special case, |length == 0| can be used to check if the CSPRNG
// is properly seeded without consuming entropy.
MUST_USE_RESULT CSPRNGResult CSPRNG(void* buffer, size_t length);

int PasswordCallback(char* buf, int size, int rwflag, void* u);

int NoPasswordCallback(char* buf, int size, int rwflag, void* u);

// Decode is used by the various stream-based crypto utilities to decode
// string input.
template <typename T>
void Decode(const v8::FunctionCallbackInfo<v8::Value>& args,
            void (*callback)(T*, const v8::FunctionCallbackInfo<v8::Value>&,
                             const char*, size_t)) {
  T* ctx;
  ASSIGN_OR_RETURN_UNWRAP(&ctx, args.This());

  if (args[0]->IsString()) {
    StringBytes::InlineDecoder decoder;
    Environment* env = Environment::GetCurrent(args);
    enum encoding enc = ParseEncoding(env->isolate(), args[1], UTF8);
    if (decoder.Decode(env, args[0].As<v8::String>(), enc).IsNothing())
      return;
    callback(ctx, args, decoder.out(), decoder.size());
  } else {
    ArrayBufferViewContents<char> buf(args[0]);
    callback(ctx, args, buf.data(), buf.length());
  }
}

#define NODE_CRYPTO_ERROR_CODES_MAP(V)                                        \
    V(CIPHER_JOB_FAILED, "Cipher job failed")                                 \
    V(DERIVING_BITS_FAILED, "Deriving bits failed")                           \
    V(ENGINE_NOT_FOUND, "Engine \"%s\" was not found")                        \
    V(INVALID_KEY_TYPE, "Invalid key type")                                   \
    V(KEY_GENERATION_JOB_FAILED, "Key generation job failed")                 \
    V(OK, "Ok")                                                               \

enum class NodeCryptoError {
#define V(CODE, DESCRIPTION) CODE,
  NODE_CRYPTO_ERROR_CODES_MAP(V)
#undef V
};

// Utility struct used to harvest error information from openssl's error stack
struct CryptoErrorStore final : public MemoryRetainer {
 public:
  void Capture();

  bool Empty() const;

  template <typename... Args>
  void Insert(const NodeCryptoError error, Args&&... args);

  v8::MaybeLocal<v8::Value> ToException(
      Environment* env,
      v8::Local<v8::String> exception_string = v8::Local<v8::String>()) const;

  SET_NO_MEMORY_INFO()
  SET_MEMORY_INFO_NAME(CryptoErrorStore)
  SET_SELF_SIZE(CryptoErrorStore)

 private:
  std::vector<std::string> errors_;
};

template <typename... Args>
void CryptoErrorStore::Insert(const NodeCryptoError error, Args&&... args) {
  const char* error_string = nullptr;
  switch (error) {
#define V(CODE, DESCRIPTION) \
    case NodeCryptoError::CODE: error_string = DESCRIPTION; break;
    NODE_CRYPTO_ERROR_CODES_MAP(V)
#undef V
  }
  errors_.emplace_back(SPrintF(error_string,
                               std::forward<Args>(args)...));
}

template <typename T>
T* MallocOpenSSL(size_t count) {
  void* mem = OPENSSL_malloc(MultiplyWithOverflowCheck(count, sizeof(T)));
  CHECK_IMPLIES(mem == nullptr, count == 0);
  return static_cast<T*>(mem);
}

// A helper class representing a read-only byte array. When deallocated, its
// contents are zeroed.
class ByteSource {
 public:
  class Builder {
   public:
    // Allocates memory using OpenSSL's memory allocator.
    explicit Builder(size_t size)
        : data_(MallocOpenSSL<char>(size)), size_(size) {}

    Builder(Builder&& other) = delete;
    Builder& operator=(Builder&& other) = delete;
    Builder(const Builder&) = delete;
    Builder& operator=(const Builder&) = delete;

    ~Builder() { OPENSSL_clear_free(data_, size_); }

    // Returns the underlying non-const pointer.
    template <typename T>
    T* data() {
      return reinterpret_cast<T*>(data_);
    }

    // Returns the (allocated) size in bytes.
    size_t size() const { return size_; }

    // Returns if (allocated) size is zero.
    bool empty() const { return size_ == 0; }

    // Finalizes the Builder and returns a read-only view that is optionally
    // truncated.
    ByteSource release(std::optional<size_t> resize = std::nullopt) && {
      if (resize) {
        CHECK_LE(*resize, size_);
        if (*resize == 0) {
          OPENSSL_clear_free(data_, size_);
          data_ = nullptr;
        }
        size_ = *resize;
      }
      ByteSource out = ByteSource::Allocated(data_, size_);
      data_ = nullptr;
      size_ = 0;
      return out;
    }

   private:
    void* data_;
    size_t size_;
  };

  ByteSource() = default;
  ByteSource(ByteSource&& other) noexcept;
  ~ByteSource();

  ByteSource& operator=(ByteSource&& other) noexcept;

  ByteSource(const ByteSource&) = delete;
  ByteSource& operator=(const ByteSource&) = delete;

  template <typename T = void>
  const T* data() const {
    return reinterpret_cast<const T*>(data_);
  }

  size_t size() const { return size_; }

  bool empty() const { return size_ == 0; }

  operator bool() const { return data_ != nullptr; }

  BignumPointer ToBN() const {
    return BignumPointer(BN_bin2bn(data<unsigned char>(), size(), nullptr));
  }

  // Creates a v8::BackingStore that takes over responsibility for
  // any allocated data. The ByteSource will be reset with size = 0
  // after being called.
  std::unique_ptr<v8::BackingStore> ReleaseToBackingStore();

  v8::Local<v8::ArrayBuffer> ToArrayBuffer(Environment* env);

  v8::MaybeLocal<v8::Uint8Array> ToBuffer(Environment* env);

  static ByteSource Allocated(void* data, size_t size);
  static ByteSource Foreign(const void* data, size_t size);

  static ByteSource FromEncodedString(Environment* env,
                                      v8::Local<v8::String> value,
                                      enum encoding enc = BASE64);

  static ByteSource FromStringOrBuffer(Environment* env,
                                       v8::Local<v8::Value> value);

  static ByteSource FromString(Environment* env,
                               v8::Local<v8::String> str,
                               bool ntc = false);

  static ByteSource FromBuffer(v8::Local<v8::Value> buffer,
                               bool ntc = false);

  static ByteSource FromBIO(const BIOPointer& bio);

  static ByteSource NullTerminatedCopy(Environment* env,
                                       v8::Local<v8::Value> value);

  static ByteSource FromSymmetricKeyObjectHandle(v8::Local<v8::Value> handle);

  static ByteSource FromSecretKeyBytes(
      Environment* env, v8::Local<v8::Value> value);

 private:
  const void* data_ = nullptr;
  void* allocated_data_ = nullptr;
  size_t size_ = 0;

  ByteSource(const void* data, void* allocated_data, size_t size)
      : data_(data), allocated_data_(allocated_data), size_(size) {}
};

enum CryptoJobMode {
  kCryptoJobAsync,
  kCryptoJobSync
};

CryptoJobMode GetCryptoJobMode(v8::Local<v8::Value> args);

template <typename CryptoJobTraits>
class CryptoJob : public AsyncWrap, public ThreadPoolWork {
 public:
  using AdditionalParams = typename CryptoJobTraits::AdditionalParameters;

  explicit CryptoJob(Environment* env,
                     v8::Local<v8::Object> object,
                     AsyncWrap::ProviderType type,
                     CryptoJobMode mode,
                     AdditionalParams&& params)
      : AsyncWrap(env, object, type),
        ThreadPoolWork(env, "crypto"),
        mode_(mode),
        params_(std::move(params)) {
    // If the CryptoJob is async, then the instance will be
    // cleaned up when AfterThreadPoolWork is called.
    if (mode == kCryptoJobSync) MakeWeak();
  }

  bool IsNotIndicativeOfMemoryLeakAtExit() const override {
    // CryptoJobs run a work in the libuv thread pool and may still
    // exist when the event loop empties and starts to exit.
    return true;
  }

  void AfterThreadPoolWork(int status) override {
    Environment* env = AsyncWrap::env();
    CHECK_EQ(mode_, kCryptoJobAsync);
    CHECK(status == 0 || status == UV_ECANCELED);
    std::unique_ptr<CryptoJob> ptr(this);
    // If the job was canceled do not execute the callback.
    // TODO(@jasnell): We should likely revisit skipping the
    // callback on cancel as that could leave the JS in a pending
    // state (e.g. unresolved promises...)
    if (status == UV_ECANCELED) return;
    v8::HandleScope handle_scope(env->isolate());
    v8::Context::Scope context_scope(env->context());

    // TODO(tniessen): Remove the exception handling logic here as soon as we
    // can verify that no code path in ToResult will ever throw an exception.
    v8::Local<v8::Value> exception;
    v8::Local<v8::Value> args[2];
    {
      node::errors::TryCatchScope try_catch(env);
      v8::Maybe<bool> ret = ptr->ToResult(&args[0], &args[1]);
      if (!ret.IsJust()) {
        CHECK(try_catch.HasCaught());
        exception = try_catch.Exception();
      } else if (!ret.FromJust()) {
        return;
      }
    }

    if (exception.IsEmpty()) {
      ptr->MakeCallback(env->ondone_string(), arraysize(args), args);
    } else {
      ptr->MakeCallback(env->ondone_string(), 1, &exception);
    }
  }

  virtual v8::Maybe<bool> ToResult(
      v8::Local<v8::Value>* err,
      v8::Local<v8::Value>* result) = 0;

  CryptoJobMode mode() const { return mode_; }

  CryptoErrorStore* errors() { return &errors_; }

  AdditionalParams* params() { return &params_; }

  const char* MemoryInfoName() const override {
    return CryptoJobTraits::JobName;
  }

  void MemoryInfo(MemoryTracker* tracker) const override {
    tracker->TrackField("params", params_);
    tracker->TrackField("errors", errors_);
  }

  static void Run(const v8::FunctionCallbackInfo<v8::Value>& args) {
    Environment* env = Environment::GetCurrent(args);

    CryptoJob<CryptoJobTraits>* job;
    ASSIGN_OR_RETURN_UNWRAP(&job, args.This());
    if (job->mode() == kCryptoJobAsync)
      return job->ScheduleWork();

    v8::Local<v8::Value> ret[2];
    env->PrintSyncTrace();
    job->DoThreadPoolWork();
    v8::Maybe<bool> result = job->ToResult(&ret[0], &ret[1]);
    if (result.IsJust() && result.FromJust()) {
      args.GetReturnValue().Set(
          v8::Array::New(env->isolate(), ret, arraysize(ret)));
    }
  }

  static void Initialize(
      v8::FunctionCallback new_fn,
      Environment* env,
      v8::Local<v8::Object> target) {
    v8::Isolate* isolate = env->isolate();
    v8::HandleScope scope(isolate);
    v8::Local<v8::Context> context = env->context();
    v8::Local<v8::FunctionTemplate> job = NewFunctionTemplate(isolate, new_fn);
    job->Inherit(AsyncWrap::GetConstructorTemplate(env));
    job->InstanceTemplate()->SetInternalFieldCount(
        AsyncWrap::kInternalFieldCount);
    SetProtoMethod(isolate, job, "run", Run);
    SetConstructorFunction(context, target, CryptoJobTraits::JobName, job);
  }

  static void RegisterExternalReferences(v8::FunctionCallback new_fn,
                                         ExternalReferenceRegistry* registry) {
    registry->Register(new_fn);
    registry->Register(Run);
  }

 private:
  const CryptoJobMode mode_;
  CryptoErrorStore errors_;
  AdditionalParams params_;
};

template <typename DeriveBitsTraits>
class DeriveBitsJob final : public CryptoJob<DeriveBitsTraits> {
 public:
  using AdditionalParams = typename DeriveBitsTraits::AdditionalParameters;

  static void New(const v8::FunctionCallbackInfo<v8::Value>& args) {
    Environment* env = Environment::GetCurrent(args);

    CryptoJobMode mode = GetCryptoJobMode(args[0]);

    AdditionalParams params;
    if (DeriveBitsTraits::AdditionalConfig(mode, args, 1, &params)
            .IsNothing()) {
      // The DeriveBitsTraits::AdditionalConfig is responsible for
      // calling an appropriate THROW_CRYPTO_* variant reporting
      // whatever error caused initialization to fail.
      return;
    }

    new DeriveBitsJob(env, args.This(), mode, std::move(params));
  }

  static void Initialize(
      Environment* env,
      v8::Local<v8::Object> target) {
    CryptoJob<DeriveBitsTraits>::Initialize(New, env, target);
  }

  static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
    CryptoJob<DeriveBitsTraits>::RegisterExternalReferences(New, registry);
  }

  DeriveBitsJob(
      Environment* env,
      v8::Local<v8::Object> object,
      CryptoJobMode mode,
      AdditionalParams&& params)
      : CryptoJob<DeriveBitsTraits>(
            env,
            object,
            DeriveBitsTraits::Provider,
            mode,
            std::move(params)) {}

  void DoThreadPoolWork() override {
    ClearErrorOnReturn clear_error_on_return;
    if (!DeriveBitsTraits::DeriveBits(
            AsyncWrap::env(),
            *CryptoJob<DeriveBitsTraits>::params(), &out_, this->mode())) {
      CryptoErrorStore* errors = CryptoJob<DeriveBitsTraits>::errors();
      errors->Capture();
      if (errors->Empty())
        errors->Insert(NodeCryptoError::DERIVING_BITS_FAILED);
      return;
    }
    success_ = true;
  }

  v8::Maybe<bool> ToResult(
      v8::Local<v8::Value>* err,
      v8::Local<v8::Value>* result) override {
    Environment* env = AsyncWrap::env();
    CryptoErrorStore* errors = CryptoJob<DeriveBitsTraits>::errors();
    if (success_) {
      CHECK(errors->Empty());
      *err = v8::Undefined(env->isolate());
      return DeriveBitsTraits::EncodeOutput(
          env,
          *CryptoJob<DeriveBitsTraits>::params(),
          &out_,
          result);
    }

    if (errors->Empty())
      errors->Capture();
    CHECK(!errors->Empty());
    *result = v8::Undefined(env->isolate());
    return v8::Just(errors->ToException(env).ToLocal(err));
  }

  SET_SELF_SIZE(DeriveBitsJob)
  void MemoryInfo(MemoryTracker* tracker) const override {
    tracker->TrackFieldWithSize("out", out_.size());
    CryptoJob<DeriveBitsTraits>::MemoryInfo(tracker);
  }

 private:
  ByteSource out_;
  bool success_ = false;
};

void ThrowCryptoError(Environment* env,
                      unsigned long err,  // NOLINT(runtime/int)
                      const char* message = nullptr);

#ifndef OPENSSL_NO_ENGINE
struct EnginePointer {
  ENGINE* engine = nullptr;
  bool finish_on_exit = false;

  inline EnginePointer() = default;

  inline explicit EnginePointer(ENGINE* engine_, bool finish_on_exit_ = false)
    : engine(engine_),
      finish_on_exit(finish_on_exit_) {}

  inline EnginePointer(EnginePointer&& other) noexcept
      : engine(other.engine),
        finish_on_exit(other.finish_on_exit) {
    other.release();
  }

  inline ~EnginePointer() { reset(); }

  inline EnginePointer& operator=(EnginePointer&& other) noexcept {
    if (this == &other) return *this;
    this->~EnginePointer();
    return *new (this) EnginePointer(std::move(other));
  }

  inline operator bool() const { return engine != nullptr; }

  inline ENGINE* get() { return engine; }

  inline void reset(ENGINE* engine_ = nullptr, bool finish_on_exit_ = false) {
    if (engine != nullptr) {
      if (finish_on_exit) {
        // This also does the equivalent of ENGINE_free.
        CHECK_EQ(ENGINE_finish(engine), 1);
      } else {
        CHECK_EQ(ENGINE_free(engine), 1);
      }
    }
    engine = engine_;
    finish_on_exit = finish_on_exit_;
  }

  inline ENGINE* release() {
    ENGINE* ret = engine;
    engine = nullptr;
    finish_on_exit = false;
    return ret;
  }
};

EnginePointer LoadEngineById(const char* id, CryptoErrorStore* errors);

bool SetEngine(
    const char* id,
    uint32_t flags,
    CryptoErrorStore* errors = nullptr);

void SetEngine(const v8::FunctionCallbackInfo<v8::Value>& args);
#endif  // !OPENSSL_NO_ENGINE

void GetFipsCrypto(const v8::FunctionCallbackInfo<v8::Value>& args);

void SetFipsCrypto(const v8::FunctionCallbackInfo<v8::Value>& args);

void TestFipsCrypto(const v8::FunctionCallbackInfo<v8::Value>& args);

class CipherPushContext {
 public:
  inline explicit CipherPushContext(Environment* env) : env_(env) {}

  inline void push_back(const char* str) {
    list_.emplace_back(OneByteString(env_->isolate(), str));
  }

  inline v8::Local<v8::Array> ToJSArray() {
    return v8::Array::New(env_->isolate(), list_.data(), list_.size());
  }

 private:
  std::vector<v8::Local<v8::Value>> list_;
  Environment* env_;
};

#if OPENSSL_VERSION_MAJOR >= 3
template <class TypeName,
          TypeName* fetch_type(OSSL_LIB_CTX*, const char*, const char*),
          void free_type(TypeName*),
          const TypeName* getbyname(const char*),
          const char* getname(const TypeName*)>
void array_push_back(const TypeName* evp_ref,
                     const char* from,
                     const char* to,
                     void* arg) {
  if (!from)
    return;

  const TypeName* real_instance = getbyname(from);
  if (!real_instance)
    return;

  const char* real_name = getname(real_instance);
  if (!real_name)
    return;

  // EVP_*_fetch() does not support alias names, so we need to pass it the
  // real/original algorithm name.
  // We use EVP_*_fetch() as a filter here because it will only return an
  // instance if the algorithm is supported by the public OpenSSL APIs (some
  // algorithms are used internally by OpenSSL and are also passed to this
  // callback).
  TypeName* fetched = fetch_type(nullptr, real_name, nullptr);
  if (!fetched)
    return;

  free_type(fetched);
  static_cast<CipherPushContext*>(arg)->push_back(from);
}
#else
template <class TypeName>
void array_push_back(const TypeName* evp_ref,
                     const char* from,
                     const char* to,
                     void* arg) {
  if (!from)
    return;
  static_cast<CipherPushContext*>(arg)->push_back(from);
}
#endif

// WebIDL AllowSharedBufferSource.
inline bool IsAnyBufferSource(v8::Local<v8::Value> arg) {
  return arg->IsArrayBufferView() ||
         arg->IsArrayBuffer() ||
         arg->IsSharedArrayBuffer();
}

template <typename T>
class ArrayBufferOrViewContents {
 public:
  ArrayBufferOrViewContents() = default;
  ArrayBufferOrViewContents(const ArrayBufferOrViewContents&) = delete;
  void operator=(const ArrayBufferOrViewContents&) = delete;

  inline explicit ArrayBufferOrViewContents(v8::Local<v8::Value> buf) {
    if (buf.IsEmpty()) {
      return;
    }

    CHECK(IsAnyBufferSource(buf));
    if (buf->IsArrayBufferView()) {
      auto view = buf.As<v8::ArrayBufferView>();
      offset_ = view->ByteOffset();
      length_ = view->ByteLength();
      data_ = view->Buffer()->Data();
    } else if (buf->IsArrayBuffer()) {
      auto ab = buf.As<v8::ArrayBuffer>();
      offset_ = 0;
      length_ = ab->ByteLength();
      data_ = ab->Data();
    } else {
      auto sab = buf.As<v8::SharedArrayBuffer>();
      offset_ = 0;
      length_ = sab->ByteLength();
      data_ = sab->Data();
    }
  }

  inline const T* data() const {
    // Ideally, these would return nullptr if IsEmpty() or length_ is zero,
    // but some of the openssl API react badly if given a nullptr even when
    // length is zero, so we have to return something.
    if (empty()) return &buf;
    return reinterpret_cast<T*>(data_) + offset_;
  }

  inline T* data() {
    // Ideally, these would return nullptr if IsEmpty() or length_ is zero,
    // but some of the openssl API react badly if given a nullptr even when
    // length is zero, so we have to return something.
    if (empty()) return &buf;
    return reinterpret_cast<T*>(data_) + offset_;
  }

  inline size_t size() const { return length_; }

  inline bool empty() const { return length_ == 0; }

  // In most cases, input buffer sizes passed in to openssl need to
  // be limited to <= INT_MAX. This utility method helps us check.
  inline bool CheckSizeInt32() { return size() <= INT_MAX; }

  inline ByteSource ToByteSource() const {
    return ByteSource::Foreign(data(), size());
  }

  inline ByteSource ToCopy() const {
    if (empty()) return ByteSource();
    ByteSource::Builder buf(size());
    memcpy(buf.data<void>(), data(), size());
    return std::move(buf).release();
  }

  inline ByteSource ToNullTerminatedCopy() const {
    if (empty()) return ByteSource();
    ByteSource::Builder buf(size() + 1);
    memcpy(buf.data<void>(), data(), size());
    buf.data<char>()[size()] = 0;
    return std::move(buf).release(size());
  }

  template <typename M>
  void CopyTo(M* dest, size_t len) const {
    static_assert(sizeof(M) == 1, "sizeof(M) must equal 1");
    len = std::min(len, size());
    if (len > 0 && data() != nullptr)
      memcpy(dest, data(), len);
  }

 private:
  T buf = 0;
  size_t offset_ = 0;
  size_t length_ = 0;
  void* data_ = nullptr;

  // Declaring operator new and delete as deleted is not spec compliant.
  // Therefore declare them private instead to disable dynamic alloc
  void* operator new(size_t);
  void* operator new[](size_t);
  void operator delete(void*);
  void operator delete[](void*);
};

v8::MaybeLocal<v8::Value> EncodeBignum(
    Environment* env,
    const BIGNUM* bn,
    int size,
    v8::Local<v8::Value>* error);

v8::Maybe<bool> SetEncodedValue(
    Environment* env,
    v8::Local<v8::Object> target,
    v8::Local<v8::String> name,
    const BIGNUM* bn,
    int size = 0);

bool SetRsaOaepLabel(const EVPKeyCtxPointer& rsa, const ByteSource& label);

namespace Util {
void Initialize(Environment* env, v8::Local<v8::Object> target);
void RegisterExternalReferences(ExternalReferenceRegistry* registry);
}  // namespace Util

}  // namespace crypto
}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS
#endif  // SRC_CRYPTO_CRYPTO_UTIL_H_

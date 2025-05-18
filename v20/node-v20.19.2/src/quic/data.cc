#if HAVE_OPENSSL && NODE_OPENSSL_HAS_QUIC

#include "data.h"
#include <env-inl.h>
#include <memory_tracker-inl.h>
#include <ngtcp2/ngtcp2.h>
#include <node_sockaddr-inl.h>
#include <v8.h>
#include "util.h"

namespace node {

using v8::Array;
using v8::BigInt;
using v8::Integer;
using v8::Local;
using v8::MaybeLocal;
using v8::Uint8Array;
using v8::Undefined;
using v8::Value;

namespace quic {

Path::Path(const SocketAddress& local, const SocketAddress& remote) {
  ngtcp2_addr_init(&this->local, local.data(), local.length());
  ngtcp2_addr_init(&this->remote, remote.data(), remote.length());
}

PathStorage::PathStorage() {
  ngtcp2_path_storage_zero(this);
}
PathStorage::operator ngtcp2_path() {
  return path;
}

// ============================================================================

Store::Store(std::shared_ptr<v8::BackingStore> store,
             size_t length,
             size_t offset)
    : store_(std::move(store)), length_(length), offset_(offset) {
  CHECK_LE(offset_, store_->ByteLength());
  CHECK_LE(length_, store_->ByteLength() - offset_);
}

Store::Store(std::unique_ptr<v8::BackingStore> store,
             size_t length,
             size_t offset)
    : store_(std::move(store)), length_(length), offset_(offset) {
  CHECK_LE(offset_, store_->ByteLength());
  CHECK_LE(length_, store_->ByteLength() - offset_);
}

Store::Store(v8::Local<v8::ArrayBuffer> buffer, Option option)
    : Store(buffer->GetBackingStore(), buffer->ByteLength()) {
  if (option == Option::DETACH) {
    USE(buffer->Detach(Local<Value>()));
  }
}

Store::Store(v8::Local<v8::ArrayBufferView> view, Option option)
    : Store(view->Buffer()->GetBackingStore(),
            view->ByteLength(),
            view->ByteOffset()) {
  if (option == Option::DETACH) {
    USE(view->Buffer()->Detach(Local<Value>()));
  }
}

v8::Local<v8::Uint8Array> Store::ToUint8Array(Environment* env) const {
  return !store_
             ? Uint8Array::New(v8::ArrayBuffer::New(env->isolate(), 0), 0, 0)
             : Uint8Array::New(v8::ArrayBuffer::New(env->isolate(), store_),
                               offset_,
                               length_);
}

Store::operator bool() const {
  return store_ != nullptr;
}
size_t Store::length() const {
  return length_;
}

template <typename T, typename t>
T Store::convert() const {
  T buf;
  buf.base =
      store_ != nullptr ? static_cast<t*>(store_->Data()) + offset_ : nullptr;
  buf.len = length_;
  return buf;
}

Store::operator uv_buf_t() const {
  return convert<uv_buf_t, char>();
}

Store::operator ngtcp2_vec() const {
  return convert<ngtcp2_vec, uint8_t>();
}

Store::operator nghttp3_vec() const {
  return convert<nghttp3_vec, uint8_t>();
}

void Store::MemoryInfo(MemoryTracker* tracker) const {
  tracker->TrackField("store", store_);
}

// ============================================================================

namespace {
std::string TypeName(QuicError::Type type) {
  switch (type) {
    case QuicError::Type::APPLICATION:
      return "APPLICATION";
    case QuicError::Type::TRANSPORT:
      return "TRANSPORT";
    case QuicError::Type::VERSION_NEGOTIATION:
      return "VERSION_NEGOTIATION";
    case QuicError::Type::IDLE_CLOSE:
      return "IDLE_CLOSE";
  }
  UNREACHABLE();
}
}  // namespace

QuicError::QuicError(const std::string_view reason)
    : reason_(reason), ptr_(&error_) {}

QuicError::QuicError(const ngtcp2_connection_close_error* ptr)
    : reason_(reinterpret_cast<const char*>(ptr->reason), ptr->reasonlen),
      ptr_(ptr) {}

QuicError::QuicError(const ngtcp2_connection_close_error& error)
    : reason_(reinterpret_cast<const char*>(error.reason), error.reasonlen),
      error_(error),
      ptr_(&error_) {}

QuicError::operator bool() const {
  if ((code() == QUIC_NO_ERROR && type() == Type::TRANSPORT) ||
      ((code() == QUIC_APP_NO_ERROR && type() == Type::APPLICATION))) {
    return false;
  }
  return true;
}

const uint8_t* QuicError::reason_c_str() const {
  return reinterpret_cast<const uint8_t*>(reason_.c_str());
}

bool QuicError::operator!=(const QuicError& other) const {
  return !(*this == other);
}

bool QuicError::operator==(const QuicError& other) const {
  if (this == &other) return true;
  return type() == other.type() && code() == other.code() &&
         frame_type() == other.frame_type();
}

QuicError::Type QuicError::type() const {
  return static_cast<Type>(ptr_->type);
}

QuicError::error_code QuicError::code() const {
  return ptr_->error_code;
}

uint64_t QuicError::frame_type() const {
  return ptr_->frame_type;
}

const std::string_view QuicError::reason() const {
  return reason_;
}

QuicError::operator const ngtcp2_connection_close_error&() const {
  return *ptr_;
}

QuicError::operator const ngtcp2_connection_close_error*() const {
  return ptr_;
}

MaybeLocal<Value> QuicError::ToV8Value(Environment* env) const {
  Local<Value> argv[] = {
      Integer::New(env->isolate(), static_cast<int>(type())),
      BigInt::NewFromUnsigned(env->isolate(), code()),
      Undefined(env->isolate()),
  };

  if (reason_.length() > 0 &&
      !node::ToV8Value(env->context(), reason()).ToLocal(&argv[2])) {
    return MaybeLocal<Value>();
  }
  return Array::New(env->isolate(), argv, arraysize(argv)).As<Value>();
}

std::string QuicError::ToString() const {
  std::string str = "QuicError(";
  str += TypeName(type()) + ") ";
  str += std::to_string(code());
  if (!reason_.empty()) str += ": " + reason_;
  return str;
}

void QuicError::MemoryInfo(MemoryTracker* tracker) const {
  tracker->TrackField("reason", reason_.length());
}

QuicError QuicError::ForTransport(error_code code,
                                  const std::string_view reason) {
  QuicError error(reason);
  ngtcp2_connection_close_error_set_transport_error(
      &error.error_, code, error.reason_c_str(), reason.length());
  return error;
}

QuicError QuicError::ForApplication(error_code code,
                                    const std::string_view reason) {
  QuicError error(reason);
  ngtcp2_connection_close_error_set_application_error(
      &error.error_, code, error.reason_c_str(), reason.length());
  return error;
}

QuicError QuicError::ForVersionNegotiation(const std::string_view reason) {
  return ForNgtcp2Error(NGTCP2_ERR_RECV_VERSION_NEGOTIATION, reason);
}

QuicError QuicError::ForIdleClose(const std::string_view reason) {
  return ForNgtcp2Error(NGTCP2_ERR_IDLE_CLOSE, reason);
}

QuicError QuicError::ForNgtcp2Error(int code, const std::string_view reason) {
  QuicError error(reason);
  ngtcp2_connection_close_error_set_transport_error_liberr(
      &error.error_, code, error.reason_c_str(), reason.length());
  return error;
}

QuicError QuicError::ForTlsAlert(int code, const std::string_view reason) {
  QuicError error(reason);
  ngtcp2_connection_close_error_set_transport_error_tls_alert(
      &error.error_, code, error.reason_c_str(), reason.length());
  return error;
}

QuicError QuicError::FromConnectionClose(ngtcp2_conn* session) {
  QuicError error;
  ngtcp2_conn_get_connection_close_error(session, &error.error_);
  return error;
}

QuicError QuicError::TRANSPORT_NO_ERROR =
    QuicError::ForTransport(QuicError::QUIC_NO_ERROR);
QuicError QuicError::APPLICATION_NO_ERROR =
    QuicError::ForApplication(QuicError::QUIC_APP_NO_ERROR);
QuicError QuicError::VERSION_NEGOTIATION = QuicError::ForVersionNegotiation();
QuicError QuicError::IDLE_CLOSE = QuicError::ForIdleClose();
QuicError QuicError::INTERNAL_ERROR =
    QuicError::ForNgtcp2Error(NGTCP2_ERR_INTERNAL);

}  // namespace quic
}  // namespace node

#endif  // HAVE_OPENSSL && NODE_OPENSSL_HAS_QUIC

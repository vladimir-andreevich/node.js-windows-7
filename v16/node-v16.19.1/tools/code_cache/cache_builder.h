#ifndef TOOLS_CODE_CACHE_CACHE_BUILDER_H_
#define TOOLS_CODE_CACHE_CACHE_BUILDER_H_

#include <string>
#include "v8.h"

namespace node {
namespace builtins {
class CodeCacheBuilder {
 public:
  static std::string Generate(v8::Local<v8::Context> context);
};
}  // namespace builtins
}  // namespace node

#endif  // TOOLS_CODE_CACHE_CACHE_BUILDER_H_

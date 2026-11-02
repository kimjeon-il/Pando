// CI-only profiling patch. Changes the checkout *after* checkout, before WASM build.
// Never commit the modified C++ file or the instrumented JS/WASM pair.
import {readFileSync,writeFileSync} from 'node:fs';
const path='shared/core/src/document-session.cpp';
const original="bool DocumentSession::releaseReplacement(std::uint32_t id) {if(!replacement_||id!=replacementId_)return false;replacement_.reset();replacementId_=0;return true;}";
const replacement="bool DocumentSession::releaseReplacement(std::uint32_t id) {\n    if(!replacement_||id!=replacementId_)return false;\n    const auto resetBegin=std::chrono::steady_clock::now();\n    replacement_.reset();\n    const auto resetEnd=std::chrono::steady_clock::now();\n    replacementId_=0;\n    const auto resetNanoseconds=std::chrono::duration_cast<std::chrono::nanoseconds>(resetEnd-resetBegin).count();\n    std::fprintf(stderr,\"PANDO_RESET_PROBE_NS %lld\\n\",static_cast<long long>(resetNanoseconds));\n    std::fflush(stderr);\n    return true;\n}";
let source=readFileSync(path,'utf8');
if(source.split(original).length!==2)throw new Error('The C++ replacement-release probe anchor has changed');
if(source.includes('PANDO_RESET_PROBE_NS'))throw new Error('The test-only probe is already present');
source='#include <chrono>\n#include <cstdio>\n'+source.replace(original,replacement);
writeFileSync(path,source);
if(!readFileSync(path,'utf8').includes('PANDO_RESET_PROBE_NS'))throw new Error('Probe patch was not applied');
console.log('RESET_PROBE_PATCH_OK: exact replacement_.reset() measured with steady_clock in instrumented CI build only');

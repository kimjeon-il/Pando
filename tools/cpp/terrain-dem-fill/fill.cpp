#include <gdal.h>
#include <gdal_alg.h>
#include <cpl_string.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <limits>
#include <memory>
#include <stdexcept>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {
using Dataset = std::unique_ptr<void, decltype(&GDALClose)>;

std::uint32_t number(const unsigned char* p) {
  return std::uint32_t(p[0]) | (std::uint32_t(p[1]) << 8) |
         (std::uint32_t(p[2]) << 16) | (std::uint32_t(p[3]) << 24);
}
void read_exact(void* target, std::size_t bytes) {
  if (!std::cin.read(static_cast<char*>(target), static_cast<std::streamsize>(bytes)))
    throw std::runtime_error("Truncated tint request");
}
Dataset raster(GDALDriverH driver, int width, int height, GDALDataType type) {
  auto dataset = GDALCreate(driver, "", width, height, 1, type, nullptr);
  if (!dataset) throw std::runtime_error("Cannot allocate GDAL tint raster");
  return Dataset(dataset, GDALClose);
}
void transfer(GDALRasterBandH band, GDALRWFlag direction, int width, int height,
              void* data, GDALDataType type) {
  if (GDALRasterIO(band, direction, 0, 0, width, height, data, width, height,
                   type, 0, 0) != CE_None)
    throw std::runtime_error("GDAL tint raster read/write failed");
}
unsigned char round_byte(float value) {
  if (!std::isfinite(value)) throw std::runtime_error("Tint regional fill left unresolved cells");
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  const float lower = std::floor(value), fraction = value - lower;
  const int integer = static_cast<int>(lower);
  return static_cast<unsigned char>(integer + (fraction > .5f || (fraction == .5f && integer % 2)));
}
}  // namespace

int main() {
  try {
#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    std::array<unsigned char, 16> header{};
    read_exact(header.data(), header.size());
    if (std::memcmp(header.data(), "PDTINT01", 8)) throw std::runtime_error("Invalid tint request");
    const auto width = number(header.data() + 8), height = number(header.data() + 12);
    const std::uint64_t count64 = std::uint64_t(width) * height;
    if (!width || width > 30000 || !height || height > 16384 || count64 > 12000000)
      throw std::runtime_error("Tint grid exceeds bounds");
    const std::size_t count = static_cast<std::size_t>(count64);
    std::vector<float> rgb(count * 3);
    std::vector<unsigned char> valid(count), wrapped_mask(count * 3), result(count * 3);
    read_exact(rgb.data(), rgb.size() * sizeof(float));
    read_exact(valid.data(), valid.size());
    if (std::cin.peek() != std::char_traits<char>::eof()) throw std::runtime_error("Unexpected tint request data");
    bool has_valid = false;
    for (std::size_t i = 0; i < count; ++i) if (valid[i]) {
      has_valid = true;
      for (int c = 0; c < 3; ++c)
        if (!std::isfinite(rgb[c * count + i])) throw std::runtime_error("Tint has non-finite valid land colours");
    }
    if (!has_valid) throw std::runtime_error("Tint has no valid land colours");
    if (std::atoi(GDALVersionInfo("VERSION_NUM")) < 3090000)
      throw std::runtime_error("Nearest tint fill requires GDAL 3.9 or later");
    GDALAllRegister();
    auto driver = GDALGetDriverByName("MEM");
    if (!driver) throw std::runtime_error("GDAL memory driver is unavailable");
    const int wide = static_cast<int>(width * 3), rows = static_cast<int>(height);
    for (std::uint32_t y = 0; y < height; ++y)
      for (int x = 0; x < wide; ++x)
        wrapped_mask[std::size_t(y) * wide + x] = valid[std::size_t(y) * width + x % width] ? 1 : 0;
    auto mask = raster(driver, wide, rows, GDT_Byte);
    auto mask_band = GDALGetRasterBand(mask.get(), 1);
    transfer(mask_band, GF_Write, wide, rows, wrapped_mask.data(), GDT_Byte);
    std::vector<float> wrapped(count * 3);
    for (int c = 0; c < 3; ++c) {
      for (std::uint32_t y = 0; y < height; ++y) for (int x = 0; x < wide; ++x) {
        const std::size_t i = std::size_t(y) * width + x % width;
        wrapped[std::size_t(y) * wide + x] = valid[i] ? rgb[c * count + i] : std::numeric_limits<float>::quiet_NaN();
      }
      auto image = raster(driver, wide, rows, GDT_Float32);
      auto band = GDALGetRasterBand(image.get(), 1);
      transfer(band, GF_Write, wide, rows, wrapped.data(), GDT_Float32);
      char** options = CSLSetNameValue(nullptr, "INTERPOLATION", "NEAREST");
      const auto status = GDALFillNodata(band, mask_band, width, 0, 0, options, nullptr, nullptr);
      CSLDestroy(options);
      if (status != CE_None) throw std::runtime_error("GDAL nearest tint fill failed");
      transfer(band, GF_Read, wide, rows, wrapped.data(), GDT_Float32);
      for (std::uint32_t y = 0; y < height; ++y) for (std::uint32_t x = 0; x < width; ++x)
        result[c * count + std::size_t(y) * width + x] = round_byte(wrapped[std::size_t(y) * wide + width + x]);
    }
    std::cout.write(reinterpret_cast<const char*>(result.data()), static_cast<std::streamsize>(result.size()));
    if (!std::cout) throw std::runtime_error("Cannot write tint result");
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}

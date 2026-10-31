#pragma once
#include <cstdint>
#include <functional>
#include <cstddef>
#include <memory>
#include <vector>

namespace pando::map_image {
// Opaque, interleaved 8-bit RGB. Image dimensions are capped to the map graph budget.
std::vector<std::uint8_t> resizeRgb(const std::vector<std::uint8_t>& input,
    int width,int height,int outputWidth,int outputHeight);
// Full-sized physical terrain sources; this separate path does not change the map graph budget.
std::vector<std::uint8_t> resizePhysicalRgb(const std::vector<std::uint8_t>& input,
    int width,int height,int outputWidth,int outputHeight);
// Straight-alpha RGBA; color is premultiplied during filtering.
std::vector<std::uint8_t> resizeRgba(const std::vector<std::uint8_t>& input,
    int width,int height,int outputWidth,int outputHeight);
// Opaque RGB values in RGBA storage; Pillow-compatible bilinear training input.
std::vector<std::uint8_t> resizeOpaqueBilinear(const std::vector<std::uint8_t>& input,
    int width,int height,int outputWidth,int outputHeight);
// Consume each opaque source row once in ascending order, without a full image buffer.
using OpaqueRgbaRowReader=std::function<void(int,std::uint8_t*,std::size_t)>;
class OpaqueBilinearAccumulator {
public:
    OpaqueBilinearAccumulator(int width,int height,int outputWidth,int outputHeight);
    ~OpaqueBilinearAccumulator();
    OpaqueBilinearAccumulator(const OpaqueBilinearAccumulator&)=delete;
    OpaqueBilinearAccumulator& operator=(const OpaqueBilinearAccumulator&)=delete;
    void addRow(int y,const std::uint8_t* row,std::size_t length);
    std::vector<std::uint8_t> finish();
private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};
class OpaqueBilinearColumnAccumulator {
public:
    OpaqueBilinearColumnAccumulator(int width,int height,int outputWidth,int outputHeight);
    ~OpaqueBilinearColumnAccumulator();
    OpaqueBilinearColumnAccumulator(const OpaqueBilinearColumnAccumulator&)=delete;
    OpaqueBilinearColumnAccumulator& operator=(const OpaqueBilinearColumnAccumulator&)=delete;
    void addColumn(int x,const std::uint8_t* column,std::size_t length);
    std::vector<std::uint8_t> finish();
private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};
std::vector<std::uint8_t> resizeOpaqueBilinearRows(int width,int height,int outputWidth,int outputHeight,
    const OpaqueRgbaRowReader& readRow);
std::vector<std::uint8_t> resizeOpaqueBicubic(const std::vector<std::uint8_t>& input,
    int width,int height,int outputWidth,int outputHeight);
// Pillow's two-stage thumbnail reduction for opaque RGB PDF pages.
std::vector<std::uint8_t> resizeOpaqueThumbnail(const std::vector<std::uint8_t>& input,
    int width,int height,int outputWidth,int outputHeight);
// CMYK channels are resized before conversion, matching JPEG analysis preparation.
std::vector<std::uint8_t> resizeCmykThumbnail(const std::vector<std::uint8_t>& input,
    int width,int height,int outputWidth,int outputHeight);
std::vector<std::uint8_t> rotateRgba(const std::vector<std::uint8_t>& input,
    int width,int height,int clockwiseDegrees);
}

#pragma once
#include "hydromanifest.h"
#include <QByteArray>
#include <functional>

bool verifyHydroAsset(const HydroAssetSpec& asset,QString& error,
                      const std::function<bool()>& cancelled={});
QByteArray readHydroAsset(const HydroAssetSpec& asset,bool gzip,QString& error,
                          qsizetype maxDecoded=64*1024*1024);
QByteArray inflateHydroGzip(const QByteArray& compressed,QString& error,
                            qsizetype maxDecoded=64*1024*1024);

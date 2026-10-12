#pragma once

#include <QImage>
#include <QString>
#include <QVariantList>
#include <QVariantMap>

struct ReferenceOcrResult {
    bool available=false;
    bool ok=false;
    QString reason;
    QString provider;
    QVariantList detections;

    QVariantMap toVariant() const;
};

ReferenceOcrResult detectReferenceImageTextNative(const QImage& source);

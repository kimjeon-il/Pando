#pragma once

#include <QImage>
#include <QString>
#include <QVariantList>
#include <QVariantMap>

struct ReferenceAutoGeorefResult {
    bool ok=false;
    QString reason;
    QString mode;
    QString source;
    int seedCount=0;
    int candidateCount=0;
    int inlierCount=0;
    int rejectedCount=0;
    double rmsMeters=0.0;
    double hardMaxMeters=0.0;
    QVariantList controlPoints;
    QVariantList matches;
    QVariantList rejectedIds;
    QVariantMap modelSelection;

    QVariantMap toVariant() const;
};

ReferenceAutoGeorefResult solveReferenceAutoGeoref(
    const QImage& source,
    const QVariantList& seeds,
    const QVariantMap& anchor={},
    const QString& requestedMode=QStringLiteral("auto"));

ReferenceAutoGeorefResult solveReferenceAutoGeorefFromOcr(
    const QImage& source,
    const QVariantList& seeds,
    const QVariantList& detections,
    const QVariantMap& anchor={},
    const QString& requestedMode=QStringLiteral("auto"));

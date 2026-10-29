#pragma once
#include <QJsonObject>
#include <QString>
#include <QVariant>
class QgsVectorLayer;

// Export only into the caller's new private scratch path. The Node owner
// normalizes the result and exclusively creates the user's final output.
QJsonObject exportQgisLayer(const QString& layerId,const QString& destination);
QJsonObject exportQgisVector(QgsVectorLayer* layer,const QString& destination);
QByteArray serializeQgisVariant(const QVariant& value);

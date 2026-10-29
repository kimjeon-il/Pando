#pragma once
#include <QJsonObject>
#include <QString>

// Export only into the caller's new private scratch path. The Node owner
// normalizes the result and exclusively creates the user's final output.
QJsonObject exportQgisLayer(const QString& layerId,const QString& destination);

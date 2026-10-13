#include "projectcodec.h"
#include <pandoeditor/projectcodec.h>
#include <QRegularExpression>
#include <QBuffer>
#include <QImageReader>
#include <QSvgRenderer>
#include <stdexcept>

namespace projectcodec {
namespace {
void require(bool okay,const char* detail) { if(!okay)throw std::invalid_argument(detail); }
void validateEmbeddedFlag(const std::string& value) {
    require(value.size()<=48u*1024u*1024u,"INVALID_EMBEDDED_FLAG_IMAGE: encoded payload limit");
    static const QRegularExpression pattern(QStringLiteral("^data:image/([A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$"));
    const auto match=pattern.match(QString::fromStdString(value));
    require(match.hasMatch(),"INVALID_EMBEDDED_FLAG_IMAGE");
    auto bytes=QByteArray::fromBase64(match.captured(2).toLatin1(),QByteArray::AbortOnBase64DecodingErrors);
    require(!bytes.isEmpty()&&bytes.size()<=32ll*1024*1024,"INVALID_EMBEDDED_FLAG_IMAGE: payload limit");
    if(match.captured(1).compare("svg+xml",Qt::CaseInsensitive)==0) {
        // Preserve arbitrary vector dimensions without allocating an intrinsic raster.
        require(QSvgRenderer(bytes).isValid(),"INVALID_EMBEDDED_FLAG_IMAGE");return;
    }
    QBuffer buffer(&bytes);require(buffer.open(QIODevice::ReadOnly),"INVALID_EMBEDDED_FLAG_IMAGE");
    QImageReader reader(&buffer);
    require(reader.canRead()&&reader.format()!="svg","INVALID_EMBEDDED_FLAG_IMAGE");
    const auto size=reader.size();
    require(size.isValid()&&qint64(size.width())*size.height()<=16ll*1024*1024,"INVALID_EMBEDDED_FLAG_IMAGE: pixel limit");
    require(!reader.read().isNull(),"INVALID_EMBEDDED_FLAG_IMAGE");
}

const pandoeditor::projectcodec::PlatformPorts& codecPorts() {
    static const pandoeditor::projectcodec::PlatformPorts ports{validateEmbeddedFlag};
    return ports;
}
}
void validateFlagDataUrl(const std::string& value) { validateEmbeddedFlag(value); }
pandoeditor::ProjectDocument decode(const QByteArray& data) {
    return pandoeditor::projectcodec::decode(data.toStdString(),codecPorts());
}
pandoeditor::ProjectDocument decodeWeb(const QByteArray& data) {
    return pandoeditor::projectcodec::decodeWeb(data.toStdString(),codecPorts());
}
QByteArray encode(const pandoeditor::Project& project) {
    return QByteArray::fromStdString(pandoeditor::projectcodec::encode(project,codecPorts()));
}
QByteArray encode(const pandoeditor::ProjectSnapshot& snapshot) {
    return QByteArray::fromStdString(pandoeditor::projectcodec::encode(snapshot,codecPorts()));
}
QByteArray encodeWeb(const pandoeditor::ProjectSnapshot& snapshot) {
    return QByteArray::fromStdString(pandoeditor::projectcodec::encodeWeb(snapshot,codecPorts()));
}
}
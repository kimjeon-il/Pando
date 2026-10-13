#include "hydroshardreader.h"
#include "hydroassetreader.h"
#include "verifiedfile.h"
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QMutexLocker>

namespace {
QString normalizedCanonical(const QString& path) {
    return QDir::cleanPath(QDir::fromNativeSeparators(QFileInfo(path).canonicalFilePath()));
}
bool contained(const QString& root,const QString& path) {
    const auto normalizedRoot=QDir::cleanPath(QDir::fromNativeSeparators(root));
#ifdef Q_OS_WIN
    return path.startsWith(normalizedRoot+'/',Qt::CaseInsensitive);
#else
    return path.startsWith(normalizedRoot+'/',Qt::CaseSensitive);
#endif
}
}

QByteArray HydroShardReader::readPack(quint32 offset,quint32 length,QString& error) {
    QMutexLocker lock(&mutex_);
    error.clear();
    const QFileInfo info(asset_.path);
    const auto canonical=normalizedCanonical(asset_.path);
    if(canonical.isEmpty()||!contained(asset_.assetRoot,canonical)||
       info.size()!=(asset_.fileBytes>0?asset_.fileBytes:asset_.bytes)||!length||quint64(offset)+length>quint64(asset_.bytes)){
        error=QStringLiteral("수계 shard 경로, 길이 또는 pack 범위가 올바르지 않습니다.");return {};
    }
    QFile file(canonical);
    if(!file.open(QIODevice::ReadOnly)||file.size()!=(asset_.fileBytes>0?asset_.fileBytes:asset_.bytes)){
        error=QStringLiteral("수계 shard 파일을 열 수 없습니다.");return {};
    }
    const auto identity=verifiedfile::identity(file);
    if(!verified_||identity.isEmpty()){
        if(!verifyHydroAsset(asset_,error))return {};
        verifiedCanonical_=canonical;verifiedIdentity_=identity;
        verified_=true;
    }
    if(canonical!=verifiedCanonical_||identity!=verifiedIdentity_||identity!=verifiedfile::identity(file)){
        verified_=false;
        error=QStringLiteral("수계 shard 파일이 검증 이후 변경되었습니다.");return {};
    }
    if(!file.seek(asset_.offset+offset)){
        error=QStringLiteral("수계 pack seek에 실패했습니다.");return {};
    }
    const auto compressed=file.read(length);
    const QFileInfo after(asset_.path);
    if(compressed.size()!=length||file.error()!=QFileDevice::NoError||
       normalizedCanonical(after.filePath())!=canonical||after.size()!=(asset_.fileBytes>0?asset_.fileBytes:asset_.bytes)||
       verifiedfile::identity(file)!=verifiedIdentity_){
        verified_=false;error=QStringLiteral("수계 shard가 pack 읽기 중 변경되었습니다.");return {};
    }
    return inflateHydroGzip(compressed,error);
}

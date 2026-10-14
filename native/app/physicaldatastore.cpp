#include "physicaldatastore.h"
#include "verifiedfile.h"
#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QRegularExpression>
#include <QStandardPaths>
#include <QTemporaryFile>
#include <QUuid>
#include <QFutureWatcher>
#include <QtConcurrent>
#include <cmath>

namespace {
const QRegularExpression digestPattern(QStringLiteral("^[0-9a-f]{64}$"));
const QRegularExpression segmentPattern(QStringLiteral("^[A-Za-z0-9._-]+$"));
bool safePath(const QString& value) {
    if(value.isEmpty()||QDir::isAbsolutePath(value)||value.startsWith('/')||value.contains('\\')||
       value.split('/').contains(QStringLiteral(".."))||QDir::cleanPath(value)!=value)return false;
    for(const auto& segment:value.split('/'))if(!segmentPattern.match(segment).hasMatch())return false;
    return true;
}
QString digest(const QByteArray& value) {
    return QString::fromLatin1(QCryptographicHash::hash(value,QCryptographicHash::Sha256).toHex());
}
bool contained(const QString& root,const QString& path) {
    const auto base=QDir::fromNativeSeparators(QDir::cleanPath(QFileInfo(root).absoluteFilePath()));
    const auto candidate=QDir::fromNativeSeparators(QDir::cleanPath(QFileInfo(path).absoluteFilePath()));
    return candidate==base||candidate.startsWith(base+'/',Qt::CaseInsensitive);
}
}

PhysicalInventory parsePhysicalInventory(const QByteArray& bytes) {
    PhysicalInventory result;QJsonParseError error;const auto document=QJsonDocument::fromJson(bytes,&error);
    if(error.error!=QJsonParseError::NoError||!document.isObject()) {result.error="invalid inventory JSON";return result;}
    const auto object=document.object();result.dataset=object.value("dataset").toString();
    result.version=object.value("datasetVersion").toString();result.baseUrl=QUrl(object.value("baseUrl").toString());
    if(object.value("schema")!="pandoeditor-physical-inventory"||object.value("version").toInt()!=1||
       !segmentPattern.match(result.dataset).hasMatch()||!segmentPattern.match(result.version).hasMatch()||
       !result.baseUrl.isValid()||(result.baseUrl.scheme()!="https"&&result.baseUrl.scheme()!="http")) {
        result.error="invalid inventory identity";return result;
    }
    QSet<QString> seen;
    for(const auto& value:object.value("assets").toArray()) {
        const auto row=value.toObject();PhysicalAssetSpec asset;
        asset.dataset=result.dataset;asset.version=result.version;asset.path=row.value("path").toString();
        const auto count=row.value("bytes").toDouble(-1);asset.bytes=qint64(count);
        asset.sha256=row.value("sha256").toString();
        const auto sourceUrl=row.value("sourceUrl");
        const bool explicitSource=!sourceUrl.isUndefined();
        asset.url=explicitSource?(sourceUrl.isString()?QUrl(sourceUrl.toString()):QUrl())
                                :result.baseUrl.resolved(QUrl(asset.path));
        if(!safePath(asset.path)||!std::isfinite(count)||count<=0||std::floor(count)!=count||
           !digestPattern.match(asset.sha256).hasMatch()||seen.contains(asset.path)||
           !asset.url.isValid()||asset.url.scheme()!=result.baseUrl.scheme()||asset.url.host()!=result.baseUrl.host()||
           (explicitSource&&(!asset.url.path().endsWith(QStringLiteral("/")+asset.path)||
                             !asset.url.query().isEmpty()||!asset.url.fragment().isEmpty()||
                             !asset.url.userInfo().isEmpty()))) {
            result.error="invalid inventory asset";result.assets.clear();return result;
        }
        seen.insert(asset.path);result.assets.push_back(std::move(asset));
    }
    if(result.assets.isEmpty())result.error="empty inventory";return result;
}

QString PhysicalDataStore::defaultRoot() {
    const auto app=QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    return QDir(app).filePath("physical-data");
}
PhysicalDataStore::PhysicalDataStore(QString root,int concurrency,int retries,QObject* parent)
    :QObject(parent),root_(root.isEmpty()?defaultRoot():QFileInfo(root).absoluteFilePath()),
     maximumConcurrent_(std::max(1,concurrency)),maximumRetries_(std::max(0,retries)) {QDir().mkpath(root_);}
void PhysicalDataStore::setExternalRoot(QString root) {externalRoot_=root.isEmpty()?QString():QFileInfo(root).absoluteFilePath();}
void PhysicalDataStore::setExternalDatasetRoot(const QString& dataset,QString root) {
    if(!segmentPattern.match(dataset).hasMatch())return;
    if(root.isEmpty())externalDatasetRoots_.remove(dataset);
    else externalDatasetRoots_.insert(dataset,QFileInfo(root).absoluteFilePath());
}
bool PhysicalDataStore::validAsset(const PhysicalAssetSpec& asset) {
    return segmentPattern.match(asset.dataset).hasMatch()&&segmentPattern.match(asset.version).hasMatch()&&
        safePath(asset.path)&&asset.bytes>0&&digestPattern.match(asset.sha256).hasMatch()&&
        asset.url.isValid()&&(asset.url.scheme()=="https"||asset.url.scheme()=="http");
}
QString PhysicalDataStore::cachePath(const PhysicalAssetSpec& asset) const {
    return assetPath(root_,asset);
}
QString PhysicalDataStore::assetPath(const QString& root,const PhysicalAssetSpec& asset) {
    if(!validAsset(asset))return {};
    if(root.isEmpty())return {};
    const auto path=QDir(root).filePath(asset.dataset+'/'+asset.version+'/'+asset.path);
    return contained(root,path)?QDir::cleanPath(path):QString();
}
QString PhysicalDataStore::externalPath(const PhysicalAssetSpec& asset) const {
    const auto root=externalDatasetRoots_.value(asset.dataset,externalRoot_);
    return assetPath(root,asset);
}
QString PhysicalDataStore::resolveExisting(const PhysicalAssetSpec& asset) const {
    const auto external=externalPath(asset);if(!external.isEmpty()&&verified(external,asset))return external;
    const auto cached=cachePath(asset);return verified(cached,asset)?cached:QString();
}
bool PhysicalDataStore::hasVerifiedExisting(const PhysicalAssetSpec& asset) const {
    const auto admitted=[&](const QString& path) {
        QFile file(path);
        return !path.isEmpty()&&file.open(QIODevice::ReadOnly)&&file.size()==asset.bytes&&
            verifiedfile::hasReceipt(file,0,asset.bytes,asset.sha256,asset.dataset+'/'+asset.version);
    };
    return admitted(externalPath(asset))||admitted(cachePath(asset));
}
std::function<QString(const PhysicalAssetSpec&)> PhysicalDataStore::verifiedResolver() const {
    return [cacheRoot=root_,externalRoot=externalRoot_,datasetRoots=externalDatasetRoots_](const PhysicalAssetSpec& asset) {
        const auto external=assetPath(datasetRoots.value(asset.dataset,externalRoot),asset);
        if(!external.isEmpty()&&verified(external,asset))return external;
        const auto cached=assetPath(cacheRoot,asset);return verified(cached,asset)?cached:QString{};
    };
}
std::function<QString(const PhysicalAssetSpec&)> PhysicalDataStore::plannedPathResolver() const {
    return [cacheRoot=root_](const PhysicalAssetSpec& asset){return assetPath(cacheRoot,asset);};
}
QString PhysicalDataStore::candidateAssetPath(const QString& cacheRoot,const QString& externalRoot,
                                            const QHash<QString,QString>& datasetRoots,const PhysicalAssetSpec& asset) {
    const auto exists=[&](const QString& path){const QFileInfo file(path);
        return !path.isEmpty()&&file.isFile()&&file.isReadable()&&file.size()==asset.bytes;};
    const auto external=assetPath(datasetRoots.value(asset.dataset,externalRoot),asset);
    if(exists(external))return external;
    const auto cached=assetPath(cacheRoot,asset);return exists(cached)?cached:QString{};
}
QString PhysicalDataStore::candidatePath(const PhysicalAssetSpec& asset) const {
    return candidateAssetPath(root_,externalRoot_,externalDatasetRoots_,asset);
}
std::function<QString(const PhysicalAssetSpec&)> PhysicalDataStore::candidatePathResolver() const {
    return [cacheRoot=root_,externalRoot=externalRoot_,datasetRoots=externalDatasetRoots_](const PhysicalAssetSpec& asset){
        return candidateAssetPath(cacheRoot,externalRoot,datasetRoots,asset);
    };
}
bool PhysicalDataStore::installVerified(const PhysicalAssetSpec& asset,const QByteArray& bytes) {
    return installBytes(root_,asset,bytes);
}
bool PhysicalDataStore::installBytes(const QString& root,const PhysicalAssetSpec& asset,const QByteArray& bytes) {
    if(!validAsset(asset)||bytes.size()!=asset.bytes||digest(bytes)!=asset.sha256)return false;
    const auto target=assetPath(root,asset);if(verified(target,asset))return true;
    if(!QDir().mkpath(QFileInfo(target).absolutePath()))return false;
    QTemporaryFile file(target+".prepare.XXXXXX");
    if(!file.open()||file.write(bytes)!=bytes.size()||!file.flush())return false;
    file.close();if(!verified(file.fileName(),asset))return false;
    if(verified(target,asset))return true;
    if(QFile::exists(target)&&!QFile::rename(target,target+".corrupt."+QUuid::createUuid().toString(QUuid::WithoutBraces)))return false;
    if(!file.rename(target))return false;file.setAutoRemove(false);
    // Renaming changes the opened file's change-time identity. Publish only
    // after the worker has verified the final path and recorded that identity.
    return verified(target,asset);
}
std::function<PhysicalAssetPreparation(const std::function<bool()>&)> PhysicalDataStore::promotionJob(
    const PhysicalAssetSpec& asset) const {
    return [asset,cacheRoot=root_,externalRoot=externalRoot_,datasetRoots=externalDatasetRoots_](
        const std::function<bool()>& cancelled)->PhysicalAssetPreparation {
        const auto target=assetPath(cacheRoot,asset);
        if(target.isEmpty())return {{},"invalid physical asset promotion"};
        if(verified(target,asset,cancelled))return {target,{}};
        if(cancelled&&cancelled())return {};
        const auto external=assetPath(datasetRoots.value(asset.dataset,externalRoot),asset);
        if(external.isEmpty()||!verified(external,asset,cancelled))return {};
        QFile input(external);
        if(!input.open(QIODevice::ReadOnly))return {{},"cannot read verified physical source"};
        const auto before=verifiedfile::identity(input);
        if(!QDir().mkpath(QFileInfo(target).absolutePath()))return {{},"cannot create physical cache directory"};
        QTemporaryFile output(target+".prepare.XXXXXX");
        if(!output.open())return {{},"cannot prepare physical cache asset"};
        QCryptographicHash hash(QCryptographicHash::Sha256);qint64 count=0;
        while(!input.atEnd()) {
            if(cancelled&&cancelled())return {};
            const auto chunk=input.read(256*1024);
            if(chunk.isEmpty()||output.write(chunk)!=chunk.size())return {{},"cannot copy physical cache asset"};
            hash.addData(chunk);count+=chunk.size();
        }
        if(count!=asset.bytes||hash.result().toHex()!=asset.sha256.toLatin1()||
           before!=verifiedfile::identity(input)||!output.flush())return {{},"physical source changed during promotion"};
        output.close();
        if(cancelled&&cancelled())return {};
        // Another request may have completed while the worker was copying.
        if(verified(target,asset,cancelled))return {target,{}};
        if(QFile::exists(target)&&!QFile::rename(target,target+".corrupt."+QUuid::createUuid().toString(QUuid::WithoutBraces)))
            return {{},"cannot preserve corrupt physical cache asset"};
        if(!output.rename(target))return {{},"cannot install verified physical cache asset"};
        output.setAutoRemove(false);
        if(!verified(target,asset,cancelled))return {{},"physical cache changed during installation"};
        return {target,{}};
    };
}
bool PhysicalDataStore::verified(const QString& path,const PhysicalAssetSpec& asset,const std::function<bool()>& cancelled) {
    QFile file(path);if(!file.open(QIODevice::ReadOnly)||file.size()!=asset.bytes)return false;
    return verifiedfile::digest(file,0,asset.bytes,asset.sha256,asset.dataset+'/'+asset.version,cancelled).valid;
}
void PhysicalDataStore::quarantine(const QString& path) const {
    if(!QFile::exists(path)||!contained(root_,path))return;
    auto destination=path+".corrupt";for(int suffix=1;QFile::exists(destination);++suffix)destination=path+QString(".corrupt.%1").arg(suffix);
    QFile::rename(path,destination);
}
void PhysicalDataStore::request(const PhysicalAssetSpec& asset) {
    if(!validAsset(asset)){emit assetFailed(asset.path,"invalid physical asset request");return;}
    const auto target=cachePath(asset);if(pending_.contains(target))return;
    pending_.insert(target);
    auto* watcher=new QFutureWatcher<QString>(this);
    connect(watcher,&QFutureWatcher<QString>::finished,this,[this,watcher,asset,target] {
        const auto existing=watcher->result();watcher->deleteLater();
        if(!existing.isEmpty()){pending_.remove(target);emit assetReady(asset.path,existing,true);return;}
        quarantine(target);QFile::remove(target+".part");queue_.enqueue({asset,0});emit activityChanged(active_,queue_.size());pump();
    });
    watcher->setFuture(QtConcurrent::run([verifier=verifiedResolver(),asset]{return verifier(asset);}));
}
void PhysicalDataStore::pump() {
    while(active_<maximumConcurrent_&&!queue_.isEmpty())start(queue_.dequeue());
    emit activityChanged(active_,queue_.size());
}
void PhysicalDataStore::start(Job job) {
    ++active_;auto* reply=network_.get(QNetworkRequest(job.asset.url));
    connect(reply,&QNetworkReply::finished,this,[this,reply,job=std::move(job)]() mutable {
        const auto networkError=reply->error();const auto message=reply->errorString();auto data=reply->readAll();reply->deleteLater();
        if(networkError!=QNetworkReply::NoError){finish(std::move(job),false,message);return;}
        struct InstallResult {bool installed=false;QString error;};
        auto* watcher=new QFutureWatcher<InstallResult>(this);
        connect(watcher,&QFutureWatcher<InstallResult>::finished,this,[this,watcher,job] {
            const auto result=watcher->result();watcher->deleteLater();
            finish(job,result.installed,result.error);
        });
        watcher->setFuture(QtConcurrent::run([root=root_,asset=job.asset,data=std::move(data)] {
            try {
                const auto installed=installBytes(root,asset,data);
                return InstallResult{installed,installed?QString{}:QStringLiteral("physical asset verification failed")};
            }catch(const std::exception& error){return InstallResult{false,QString::fromUtf8(error.what())};}
             catch(...){return InstallResult{false,QStringLiteral("physical asset installation failed with an unknown error")};}
        }));
    });
}
void PhysicalDataStore::finish(Job job,bool installed,const QString& error) {
    --active_;const auto target=cachePath(job.asset);
    if(installed){pending_.remove(target);emit assetReady(job.asset.path,target,false);}
    else if(job.failures<maximumRetries_) {++job.failures;queue_.enqueue(std::move(job));}
    else {pending_.remove(target);emit assetFailed(job.asset.path,error);}
    pump();
}
bool PhysicalDataStore::cleanupVersions(const QString& dataset,const QString& keepVersion) {
    return cleanupVersionsJob(dataset,keepVersion,{})();
}
std::function<bool()> PhysicalDataStore::cleanupVersionsJob(
    const QString& dataset,const QString& keepVersion,QStringList protectedSources) const {
    return [root=root_,dataset,keepVersion,protectedSources=std::move(protectedSources)] {
    if(!segmentPattern.match(dataset).hasMatch()||!segmentPattern.match(keepVersion).hasMatch())return false;
    const auto datasetRoot=QDir(root).filePath(dataset);if(!contained(root,datasetRoot))return false;
    QDir directory(datasetRoot);if(!directory.exists())return true;
    bool okay=true;for(const auto& name:directory.entryList(QDir::Dirs|QDir::NoDotAndDotDot)) {
        if(name==keepVersion)continue;const auto target=directory.filePath(name);
        if(std::any_of(protectedSources.cbegin(),protectedSources.cend(),[&](const auto& source) {
            return !source.isEmpty()&&contained(target,source);
        }))continue;
        if(!contained(datasetRoot,target)||!verifiedfile::removeUnownedDirectory(target))okay=false;
    }
    return okay;
    };
}

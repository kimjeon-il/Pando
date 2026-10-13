#include "hydroruntimeprovider.h"
#include "physicaldatastore.h"
#include "verifiedfile.h"
#include <QCoreApplication>
#include <QDateTime>
#include <QDirIterator>
#include <QEventLoop>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTimer>
#include <QTemporaryDir>
#include <QtConcurrent>
#include <iostream>
#include <stdexcept>

namespace {
void require(bool value,const char* message){if(!value)throw std::runtime_error(message);}
QString sha(const QByteArray& bytes){return QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex());}
void write(const QString& path,const QByteArray& bytes){QFile file(path);require(file.open(QIODevice::WriteOnly),"open fixture");require(file.write(bytes)==bytes.size(),"write fixture");}
}
int main(int argc,char** argv) {
    QCoreApplication app(argc,argv);
    QTemporaryDir temporary;require(temporary.isValid(),"temporary source directory");
    const auto path=temporary.filePath("asset.bin");const QByteArray bytes="small verified startup source";
    write(path,bytes);
    QFile file(path);require(file.open(QIODevice::ReadOnly),"open source");
    require(verifiedfile::digest(file,0,bytes.size(),sha(bytes),"v1").valid,"initial digest");
    const auto second=verifiedfile::digest(file,0,bytes.size(),sha(bytes),"v1");
    require(second.valid,"repeat digest");
    if(!verifiedfile::identity(file).isEmpty())require(second.reused,"safe identity receipt reuse");
    require(!verifiedfile::digest(file,0,bytes.size(),sha(bytes),"v2").reused,"version receipt isolation");
    require(!verifiedfile::digest(file,0,bytes.size(),sha(bytes),"v1",[]{return true;}).valid,"cancelled receipt not admitted");
    const auto modified=QFileInfo(path).lastModified();file.close();
    write(path,QByteArray(bytes.size(),'x'));
    require(file.open(QIODevice::ReadWrite),"open same-size changed source");
    require(file.setFileTime(modified,QFileDevice::FileModificationTime),"restore mtime");
    require(!verifiedfile::digest(file,0,bytes.size(),sha(bytes),"v1").valid,"same-size edit with restored mtime invalidates");file.close();
    require(QFile::rename(path,path+".original"),"retain changed file");write(path,QByteArray(bytes.size(),'y'));
    require(file.open(QIODevice::ReadOnly),"open replacement source");
    require(!verifiedfile::digest(file,0,bytes.size(),sha(bytes),"v1").valid,"file replacement invalidates receipt");file.close();

    const QString fixture=QStringLiteral(WEB_HYDRO_FIXTURE)+"/v0.13.1/manifest.json";
    auto future=QtConcurrent::run([fixture]{return HydroRuntimeProvider::prepareOpen(fixture,false);});
    auto prepared=future.result();require(prepared.ready(),qPrintable(prepared.error));
    HydroRuntimeProvider owner;QString error;
    require(owner.install(std::move(prepared),"startup-A",error),qPrintable(error));
    const auto identity=owner.sourceIdentity();require(identity.has_value(),"installed source identity");
    auto cancelled=HydroRuntimeProvider::prepareOpen(fixture,false,[]{return true;});
    require(!cancelled.ready(),"cancelled source not prepared");
    require(!owner.install(std::move(cancelled),"startup-B",error),"cancelled source not installed");
    require(owner.sourceIdentity()==identity,"failed installation preserves source");
    auto next=HydroRuntimeProvider::prepareOpen(fixture,false);require(next.ready(),qPrintable(next.error));
    require(owner.install(std::move(next),"startup-B",error),qPrintable(error));
    require(owner.sourceIdentity()->generation!=identity->generation,"successful installation advances generation");
    const auto fixtureRoot=QStringLiteral(WEB_HYDRO_FIXTURE);
    const auto copiedRoot=temporary.filePath("hydro-fixture");
    QDirIterator files(fixtureRoot,QDir::Files,QDirIterator::Subdirectories);std::size_t copies=0;
    while(files.hasNext()) {
        const auto original=files.next();const auto relative=QDir(fixtureRoot).relativeFilePath(original);
        const auto copied=QDir(copiedRoot).filePath(relative);
        require(++copies<=32,"bounded fixture copy");
        require(QDir().mkpath(QFileInfo(copied).absolutePath()),"fixture destination");
        require(QFile::copy(original,copied),"copy tiny hydro fixture");
    }
    const auto changedManifest=copiedRoot+"/v0.13.1/manifest.json";
    auto stale=HydroRuntimeProvider::prepareOpen(changedManifest,false);require(stale.ready(),qPrintable(stale.error));
    const auto beforeStale=owner.sourceIdentity();
    QFile manifest(changedManifest);require(manifest.open(QIODevice::Append),"open prepared manifest");
    require(manifest.write("\n")==1,"change prepared manifest");manifest.close();
    require(!owner.install(std::move(stale),"stale",error),"changed prepared source rejected");
    require(owner.sourceIdentity()==beforeStale,"stale source preserves installed identity");
    owner.close("startup-C");require(!owner.isOpen(),"closed source");

    const auto external=temporary.filePath("external");QDir().mkpath(external+"/physical/v1");
    const PhysicalAssetSpec asset{"physical","v1","small.bin",bytes.size(),sha(bytes),QUrl("https://example.invalid/small.bin")};
    write(external+"/physical/v1/small.bin",bytes);
    PhysicalDataStore store(temporary.filePath("cache"));store.setExternalRoot(external);
    const auto job=store.promotionJob(asset);
    require(job([]{return true;}).path.isEmpty(),"cancelled promotion not admitted");
    auto promoted=QtConcurrent::run([job]{return job({});}).result();
    require(promoted.error.isEmpty()&&promoted.path==store.cachePath(asset),"worker source promotion");
    require(store.resolveExisting(asset)==external+"/physical/v1/small.bin","promoted source remains verified");
    require(job({}).path==store.cachePath(asset),"verified cache reused");
    const auto restored=store.root()+"/physical/restored/source";
    const auto obsolete=store.root()+"/physical/obsolete";
    require(QDir().mkpath(restored)&&QDir().mkpath(obsolete),"version maintenance fixture");
    const auto cleanup=store.cleanupVersionsJob("physical","v1",{restored});
    auto activeSource=verifiedfile::leaseSource(obsolete+"/owned.bin");
    require(QtConcurrent::run(cleanup).result(),"worker version maintenance");
    require(QDir(restored).exists()&&QDir(store.root()+"/physical/v1").exists(),"restore/current versions protected");
    require(QDir(obsolete).exists(),"active worker source remains protected");
    activeSource.reset();require(QtConcurrent::run(cleanup).result(),"released version maintenance");
    require(!QDir(obsolete).exists(),"unused old version removed");

    QTcpServer server;require(server.listen(QHostAddress::LocalHost),"tiny download fixture");int requests=0;
    QObject::connect(&server,&QTcpServer::newConnection,&server,[&] {
        while(auto* socket=server.nextPendingConnection())QObject::connect(socket,&QTcpSocket::readyRead,socket,[&,socket] {
            socket->readAll();const auto payload=++requests==1?QByteArray(bytes.size(),'!'):bytes;
            socket->write("HTTP/1.1 200 OK\r\nContent-Length: "+QByteArray::number(payload.size())+"\r\nConnection: close\r\n\r\n"+payload);
            socket->disconnectFromHost();
        });
    });
    PhysicalDataStore downloaded(temporary.filePath("download-cache"),1,1);
    auto download=asset;download.url=QUrl(QString("http://127.0.0.1:%1/small.bin").arg(server.serverPort()));
    QEventLoop loop;QTimer timeout;timeout.setSingleShot(true);timeout.setInterval(5000);
    QObject::connect(&timeout,&QTimer::timeout,&loop,&QEventLoop::quit);
    int ready=0,failed=0;bool reused=false;
    QObject::connect(&downloaded,&PhysicalDataStore::assetReady,&loop,[&](const auto&,const auto&,bool existing) {++ready;reused=existing;loop.quit();});
    QObject::connect(&downloaded,&PhysicalDataStore::assetFailed,&loop,[&](const auto&,const auto&) {++failed;loop.quit();});
    downloaded.request(download);timeout.start();loop.exec();
    require(ready==1&&failed==0&&requests==2&&!reused,"download checksum retry and worker installation");
    downloaded.request(download);timeout.start();loop.exec();
    require(ready==2&&failed==0&&requests==2&&reused,"verified reuse without another network request");
    std::cout<<"startup source: worker prepare/install, cancel/generation, safe receipt and promotion checks passed\n";
}

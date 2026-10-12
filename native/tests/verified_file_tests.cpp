#include "physicaldatastore.h"
#include "verifiedfile.h"
#include <QCoreApplication>
#include <QDateTime>
#include <QEventLoop>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTemporaryDir>
#include <QTimer>
#include <stdexcept>
#include <iostream>

namespace {
void require(bool result,const char* message) {if(!result)throw std::runtime_error(message);}
QString sha(const QByteArray& bytes) {return QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex());}
void write(const QString& path,const QByteArray& bytes) {
    QFile file(path);require(file.open(QIODevice::WriteOnly),"open tiny source");
    require(file.write(bytes)==bytes.size(),"write tiny source");
}
}
int main(int argc,char** argv) {
    QCoreApplication app(argc,argv);
    QTemporaryDir directory;require(directory.isValid(),"fixture directory");
    const QByteArray bytes="tiny hydro receipt";
    const auto path=directory.filePath("source.bin");write(path,bytes);
    QFile file(path);require(file.open(QIODevice::ReadOnly),"open receipt fixture");
    require(file.seek(3),"fixture position");
    require(!verifiedfile::hasReceipt(file,0,bytes.size(),sha(bytes),"physical/v1"),"cold receipt is not admitted");
    require(file.pos()==3,"cold lookup does not read or seek content");
    require(verifiedfile::digest(file,0,bytes.size(),sha(bytes),"physical/v1").valid,"worker verifier creates a receipt");
    require(file.seek(4),"verified fixture position");
    if(!verifiedfile::identity(file).isEmpty()) {
        require(verifiedfile::hasReceipt(file,0,bytes.size(),sha(bytes),"physical/v1"),"matching receipt reused");
        require(file.pos()==4,"known lookup does not read or seek content");
    }
    require(!verifiedfile::hasReceipt(file,0,bytes.size(),sha(bytes),"physical/v2"),"version isolation");
    require(!verifiedfile::hasReceipt(file,0,bytes.size(),sha(bytes),"physical/v1-other"),"dataset identity isolation");
    require(!verifiedfile::hasReceipt(file,0,bytes.size(),sha(QByteArray(bytes.size(),'!')),"physical/v1"),"digest isolation");
    const auto previousModified=QFileInfo(path).lastModified();file.close();
    write(path,QByteArray(bytes.size(),'x'));
    require(file.open(QIODevice::ReadWrite),"open changed source");
    require(file.setFileTime(previousModified,QFileDevice::FileModificationTime),"restore modification time");
    require(!verifiedfile::hasReceipt(file,0,bytes.size(),sha(bytes),"physical/v1"),"same-size edit invalidates known receipt");
    file.close();require(QFile::rename(path,path+".old"),"preserve prior source");write(path,bytes);
    require(file.open(QIODevice::ReadOnly),"open replacement source");
    require(!verifiedfile::hasReceipt(file,0,bytes.size(),sha(bytes),"physical/v1"),"replacement invalidates known receipt");
    file.close();

    QTcpServer server;require(server.listen(QHostAddress::LocalHost),"bounded local server");int requests=0;
    QObject::connect(&server,&QTcpServer::newConnection,&server,[&] {
        while(auto* socket=server.nextPendingConnection())QObject::connect(socket,&QTcpSocket::readyRead,socket,[&,socket] {
            socket->readAll();const auto payload=++requests==1?QByteArray(bytes.size(),'!'):bytes;
            socket->write("HTTP/1.1 200 OK\r\nContent-Length: "+QByteArray::number(payload.size())+"\r\nConnection: close\r\n\r\n"+payload);
            socket->disconnectFromHost();
        });
    });
    const auto external=directory.filePath("external");require(QDir().mkpath(external+"/physical/v1"),"external fixture");
    const auto externalPath=external+"/physical/v1/small.bin";write(externalPath,bytes);
    PhysicalAssetSpec asset{"physical","v1","small.bin",bytes.size(),sha(bytes),
        QUrl(QString("http://127.0.0.1:%1/small.bin").arg(server.serverPort()))};
    PhysicalDataStore store(directory.filePath("cache"),1,1);store.setExternalRoot(external);
    require(!store.hasVerifiedExisting(asset),"cold owner query cannot produce verification");
    QEventLoop loop;QTimer deadline;deadline.setSingleShot(true);deadline.setInterval(5000);
    QObject::connect(&deadline,&QTimer::timeout,&loop,&QEventLoop::quit);
    int ready=0,failed=0;bool reused=false;
    QObject::connect(&store,&PhysicalDataStore::assetReady,&loop,[&](const auto&,const auto&,bool known) {++ready;reused=known;loop.quit();});
    QObject::connect(&store,&PhysicalDataStore::assetFailed,&loop,[&](const auto&,const auto&) {++failed;loop.quit();});
    store.request(asset);deadline.start();loop.exec();
    require(ready==1&&failed==0&&reused&&requests==0,"cold valid source verified asynchronously without download");
    require(store.hasVerifiedExisting(asset),"owner observes worker receipt");
    write(externalPath,QByteArray(bytes.size(),'x'));
    require(!store.hasVerifiedExisting(asset),"changed source does not stay ready");
    store.request(asset);deadline.start();loop.exec();
    require(ready==2&&failed==0&&!reused&&requests==2,"corrupt source retains checksum retry and recovery");
    require(store.hasVerifiedExisting(asset),"repaired cache is verified");
    std::cout<<"verified file: cold lookup, worker admission, mutation, replacement and retry passed\n";
}

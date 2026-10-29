// Native QGIS 3.44 bridge. QGIS owns this plugin and dispatches socket events
// on its GUI thread; no arbitrary code execution is exposed.
#include "qgis-export.h"
#include <qgis.h>
#include <qgisinterface.h>
#include <qgisplugin.h>
#include <qgsproject.h>
#include <qgsvectorlayer.h>
#include <QCoreApplication>
#include <QFileInfo>
#include <QHostAddress>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTimer>
#include <algorithm>
#include <exception>
#include <memory>

namespace {
const QString pluginName=QStringLiteral("Pando native bridge");
const QString pluginDescription=QStringLiteral("Authenticated local Pando and QGIS exchange");
const QString pluginCategory=QStringLiteral("Pando");
const QString pluginVersion=QStringLiteral("0.1.0");

bool tokenMatches(const QByteArray& actual,const QByteArray& expected){
    const auto length=std::max(actual.size(),expected.size());unsigned int difference=static_cast<unsigned int>(actual.size()^expected.size());
    for(int i=0;i<length;++i)difference|=static_cast<unsigned char>(i<actual.size()?actual[i]:0)^static_cast<unsigned char>(i<expected.size()?expected[i]:0);
    return difference==0;
}
class Bridge final:public QObject,public QgisPlugin {
    QTcpServer server_;QByteArray token_;int active_=0;
    QJsonObject execute(const QJsonObject& request){
        const auto command=request.value(QStringLiteral("command")).toString();
        if(command==QStringLiteral("status"))return {{QStringLiteral("qgis_version"),Qgis::version()},
            {QStringLiteral("pid"),static_cast<double>(QCoreApplication::applicationPid())},{QStringLiteral("transport"),QStringLiteral("pando-native-v1")}};
        if(command==QStringLiteral("open")){
            const auto path=request.value(QStringLiteral("path")).toString();const QFileInfo file(path);
            if(!file.isAbsolute()||!file.isFile())throw QStringLiteral("An existing absolute vector file is required");
            auto layer=std::make_unique<QgsVectorLayer>(file.absoluteFilePath(),file.completeBaseName(),QStringLiteral("ogr"));
            if(!layer->isValid())throw QStringLiteral("QGIS could not open the vector layer");
            if(!QgsProject::instance()->addMapLayer(layer.get()))throw QStringLiteral("QGIS could not add the vector layer");
            auto* added=layer.release();
            return {{QStringLiteral("id"),added->id()},{QStringLiteral("name"),added->name()},
                {QStringLiteral("feature_count"),static_cast<double>(added->featureCount())},{QStringLiteral("crs"),added->crs().authid()}};
        }
        if(command==QStringLiteral("export"))return exportQgisLayer(request.value(QStringLiteral("layer")).toString(),
            request.value(QStringLiteral("output")).toString());
        throw QStringLiteral("Unsupported native QGIS command");
    }
    void acceptConnection(){
        while(server_.hasPendingConnections()){
            auto* socket=server_.nextPendingConnection();
            if(!socket)continue;
            if(socket->peerAddress()!=QHostAddress(QHostAddress::LocalHost)||active_>=16){socket->disconnectFromHost();socket->deleteLater();continue;}
            ++active_;
            auto data=std::make_shared<QByteArray>();auto handled=std::make_shared<bool>(false);
            QObject::connect(socket,&QTcpSocket::disconnected,this,[this,socket]{--active_;socket->deleteLater();});
            QTimer::singleShot(30000,socket,[socket]{socket->abort();});
            QObject::connect(socket,&QTcpSocket::readyRead,this,[this,socket,data,handled]{
                if(*handled)return;
                data->append(socket->readAll());
                if(data->size()>1024*1024){socket->abort();return;}
                const auto newline=data->indexOf('\n');if(newline<0)return;
                *handled=true;
                QJsonObject response;
                try{
                    if(!data->mid(newline+1).trimmed().isEmpty())throw QStringLiteral("Only one request is allowed");
                    QJsonParseError error;const auto document=QJsonDocument::fromJson(data->left(newline),&error);
                    if(error.error!=QJsonParseError::NoError||!document.isObject())throw QStringLiteral("Invalid request");
                    const auto request=document.object();const auto supplied=request.value(QStringLiteral("token"));
                    if(!supplied.isString()||!tokenMatches(supplied.toString().toUtf8(),token_))throw QStringLiteral("Authentication failed");
                    response={{QStringLiteral("ok"),true},{QStringLiteral("result"),execute(request)}};
                }catch(const QString& message){response={{QStringLiteral("ok"),false},{QStringLiteral("error"),message}};}
                catch(const std::exception& error){response={{QStringLiteral("ok"),false},{QStringLiteral("error"),QString::fromUtf8(error.what())}};}
                socket->write(QJsonDocument(response).toJson(QJsonDocument::Compact)+'\n');socket->disconnectFromHost();
            });
        }
    }
public:
    explicit Bridge(QgisInterface*):QgisPlugin(pluginName,pluginDescription,pluginCategory,pluginVersion,QgisPlugin::UI){}
    void initGui() override{
        token_=qgetenv("PANDO_QGIS_NATIVE_TOKEN");bool valid=false;const auto port=qgetenv("PANDO_QGIS_NATIVE_PORT").toUShort(&valid);
        if(token_.isEmpty()||token_.size()>4096||!valid||port<1024){qWarning("Pando native QGIS bridge configuration is missing or invalid");return;}
        QObject::connect(&server_,&QTcpServer::newConnection,this,[this]{acceptConnection();});
        if(!server_.listen(QHostAddress::LocalHost,port))qWarning("Pando native QGIS bridge could not listen on its local port");
    }
    void unload() override{server_.close();for(auto* socket:server_.findChildren<QTcpSocket*>())socket->abort();token_.fill('\0');token_.clear();}
};
}
extern "C" {
Q_DECL_EXPORT QgisPlugin* classFactory(QgisInterface* iface){return new Bridge(iface);}
Q_DECL_EXPORT const QString* name(){return &pluginName;}
Q_DECL_EXPORT const QString* description(){return &pluginDescription;}
Q_DECL_EXPORT const QString* category(){return &pluginCategory;}
Q_DECL_EXPORT const QString* version(){return &pluginVersion;}
Q_DECL_EXPORT int type(){return QgisPlugin::UI;}
Q_DECL_EXPORT void unload(QgisPlugin* plugin){delete plugin;}
}

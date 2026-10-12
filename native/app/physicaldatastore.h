#pragma once

#include <QNetworkAccessManager>
#include <QObject>
#include <QQueue>
#include <QSet>
#include <QString>
#include <QStringList>
#include <QUrl>
#include <QVector>
#include <QHash>
#include <functional>

struct PhysicalAssetSpec {
    QString dataset,version,path;
    qint64 bytes=0;
    QString sha256;
    QUrl url;
};
struct PhysicalInventory {
    QString dataset,version,error;
    QUrl baseUrl;
    QVector<PhysicalAssetSpec> assets;
    bool valid() const {return error.isEmpty();}
};
struct PhysicalAssetPreparation {QString path,error;};
PhysicalInventory parsePhysicalInventory(const QByteArray& json);

class PhysicalDataStore final : public QObject {
    Q_OBJECT
public:
    explicit PhysicalDataStore(QString root={},int maximumConcurrent=3,int maximumRetries=2,
                               QObject* parent=nullptr);
    QString root() const {return root_;}
    void setExternalRoot(QString root);
    void setExternalDatasetRoot(const QString& dataset,QString root);
    QString cachePath(const PhysicalAssetSpec&) const;
    QString resolveExisting(const PhysicalAssetSpec&) const;
    // Receipt-only owner-thread query. Cold/corrupt sources still go through
    // request()'s worker verification and the existing download/retry policy.
    bool hasVerifiedExisting(const PhysicalAssetSpec&) const;
    // Value-only verifier for asynchronous source owners; never captures this QObject.
    std::function<QString(const PhysicalAssetSpec&)> verifiedResolver() const;
    // Stable logical cache identity: no file access or verification. Workers
    // must still use verifiedResolver before admitting new source bytes.
    std::function<QString(const PhysicalAssetSpec&)> plannedPathResolver() const;
    // Existing expected-size file only; deliberately not an integrity receipt.
    QString candidatePath(const PhysicalAssetSpec&) const;
    std::function<QString(const PhysicalAssetSpec&)> candidatePathResolver() const;
    std::function<PhysicalAssetPreparation(const std::function<bool()>&)> promotionJob(
        const PhysicalAssetSpec&) const;
    bool installVerified(const PhysicalAssetSpec&,const QByteArray& bytes);
    void request(const PhysicalAssetSpec&);
    bool cleanupVersions(const QString& dataset,const QString& keepVersion);
    std::function<bool()> cleanupVersionsJob(const QString& dataset,const QString& keepVersion,
                                            QStringList protectedSources) const;
signals:
    void assetReady(const QString& relativePath,const QString& localPath,bool reused);
    void assetFailed(const QString& relativePath,const QString& message);
    void activityChanged(int active,int queued);
private:
    struct Job {PhysicalAssetSpec asset;int failures=0;};
    static QString defaultRoot();
    static bool validAsset(const PhysicalAssetSpec&);
    static bool verified(const QString& path,const PhysicalAssetSpec&,
                         const std::function<bool()>& cancelled={});
    static QString assetPath(const QString& root,const PhysicalAssetSpec&);
    static QString candidateAssetPath(const QString& cacheRoot,const QString& externalRoot,
                                      const QHash<QString,QString>& datasetRoots,const PhysicalAssetSpec&);
    static bool installBytes(const QString& root,const PhysicalAssetSpec&,const QByteArray&);
    QString externalPath(const PhysicalAssetSpec&) const;
    void quarantine(const QString& path) const;
    void pump();
    void start(Job job);
    void finish(Job job,bool installed,const QString& error);
    QString root_,externalRoot_;
    QHash<QString,QString> externalDatasetRoots_;
    int maximumConcurrent_=3,maximumRetries_=2,active_=0;
    QQueue<Job> queue_;
    QSet<QString> pending_;
    QNetworkAccessManager network_;
};

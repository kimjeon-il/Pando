#pragma once
#include <QCryptographicHash>
#include <QDataStream>
#include <QFile>
#include <QFileInfo>
#include <QDir>
#include <QHash>
#include <QSet>
#include <functional>
#include <mutex>
#include <algorithm>
#include <memory>
#ifdef Q_OS_WIN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <io.h>
#else
#include <sys/stat.h>
#endif

// A receipt is process-local and tied to the opened file, its change time,
// content range, expected digest and dataset version. Paths/mtime alone are
// insufficient: replacement and same-size edits must invalidate a receipt.
namespace verifiedfile {
struct SourceOwnership {std::mutex mutex;QHash<QString,std::size_t> sources;QSet<QString> deleting;};
inline std::shared_ptr<SourceOwnership> sourceOwnership() {
    static auto state=std::make_shared<SourceOwnership>();return state;
}
inline QString sourcePath(const QString& path) {
    const QFileInfo file(path);
    auto value=QDir::cleanPath(QDir::fromNativeSeparators(
        file.canonicalFilePath().isEmpty()?file.absoluteFilePath():file.canonicalFilePath()));
#ifdef Q_OS_WIN
    value=value.toLower();
#endif
    return value;
}
class SourceLease {
public:
    explicit SourceLease(const QString& path):state_(sourceOwnership()),path_(sourcePath(path)) {
        std::lock_guard lock(state_->mutex);
        for(const auto& target:state_->deleting)
            if(path_==target||path_.startsWith(target+'/'))return;
        ++state_->sources[path_];valid_=true;
    }
    bool valid() const {return valid_;}
    ~SourceLease() {
        if(!valid_)return;
        std::lock_guard lock(state_->mutex);
        auto found=state_->sources.find(path_);
        if(found!=state_->sources.end()&&!--found.value())state_->sources.erase(found);
    }
private:
    std::shared_ptr<SourceOwnership> state_;QString path_;bool valid_=false;
};
inline std::shared_ptr<SourceLease> leaseSource(const QString& path) {
    auto lease=std::make_shared<SourceLease>(path);return lease->valid()?lease:nullptr;
}
inline bool removeUnownedDirectory(const QString& path) {
    const auto state=sourceOwnership();const auto target=sourcePath(path);
    // Reserve deletion atomically with ownership, then release the short lock.
    // Owner-thread source teardown must never wait for recursive disk cleanup.
    {
        std::lock_guard lock(state->mutex);
        for(auto source=state->sources.cbegin();source!=state->sources.cend();++source)
            if(source.key()==target||source.key().startsWith(target+'/'))return true;
        if(state->deleting.contains(target))return true;
        state->deleting.insert(target);
    }
    struct Reservation {
        std::shared_ptr<SourceOwnership> state;QString target;
        ~Reservation(){std::lock_guard lock(state->mutex);state->deleting.remove(target);}
    } reservation{state,target};
    return QDir(path).removeRecursively();
}
inline QByteArray identity(QFile& file) {
    QByteArray bytes;QDataStream stream(&bytes,QIODevice::WriteOnly);
#ifdef Q_OS_WIN
    const auto handle=reinterpret_cast<HANDLE>(_get_osfhandle(file.handle()));
    FILE_ID_INFO id{};FILE_BASIC_INFO basic{};FILE_STANDARD_INFO standard{};
    if(handle==INVALID_HANDLE_VALUE||
       !GetFileInformationByHandleEx(handle,FileIdInfo,&id,sizeof(id))||
       !GetFileInformationByHandleEx(handle,FileBasicInfo,&basic,sizeof(basic))||
       !GetFileInformationByHandleEx(handle,FileStandardInfo,&standard,sizeof(standard)))return {};
    stream<<quint64(id.VolumeSerialNumber)<<qint64(standard.EndOfFile.QuadPart)
          <<qint64(basic.LastWriteTime.QuadPart)<<qint64(basic.ChangeTime.QuadPart);
    stream.writeRawData(reinterpret_cast<const char*>(id.FileId.Identifier),sizeof(id.FileId.Identifier));
#else
    struct stat info{};
    if(fstat(file.handle(),&info)!=0||!S_ISREG(info.st_mode))return {};
    stream<<quint64(info.st_dev)<<quint64(info.st_ino)<<qint64(info.st_size);
#ifdef Q_OS_MACOS
    stream<<qint64(info.st_mtimespec.tv_sec)<<qint64(info.st_mtimespec.tv_nsec)
          <<qint64(info.st_ctimespec.tv_sec)<<qint64(info.st_ctimespec.tv_nsec);
#else
    stream<<qint64(info.st_mtim.tv_sec)<<qint64(info.st_mtim.tv_nsec)
          <<qint64(info.st_ctim.tv_sec)<<qint64(info.st_ctim.tv_nsec);
#endif
#endif
    return bytes;
}
struct Result {bool valid=false,reused=false;};
struct DigestReceipts {std::mutex mutex;QHash<QByteArray,bool> values;};
inline DigestReceipts& digestReceipts() {static DigestReceipts receipts;return receipts;}
inline QByteArray receiptKey(const QByteArray& identity,const QString& version,
                             const QString& expected,qint64 offset,qint64 count) {
    QByteArray key;QDataStream stream(&key,QIODevice::WriteOnly);
    stream<<identity<<version<<expected<<offset<<count;
    return key;
}
// A cold lookup never reads or hashes content and never creates a receipt.
// Its caller must schedule the existing verifier before admitting that source.
inline bool hasReceipt(QFile& file,qint64 offset,qint64 count,const QString& expected,
                       const QString& version) {
    if(offset<0||count<1||offset>file.size()||count>file.size()-offset||expected.size()!=64)return false;
    const auto before=identity(file);if(before.isEmpty())return false;
    const auto key=receiptKey(before,version,expected,offset,count);
    auto& receipts=digestReceipts();
    {std::lock_guard lock(receipts.mutex);if(!receipts.values.contains(key))return false;}
    return before==identity(file);
}
inline Result digest(QFile& file,qint64 offset,qint64 count,const QString& expected,
                     const QString& version,const std::function<bool()>& cancelled={}) {
    if(offset<0||count<1||offset>file.size()||count>file.size()-offset||
       expected.size()!=64||(cancelled&&cancelled()))return {};
    const auto before=identity(file);
    const auto key=receiptKey(before,version,expected,offset,count);
    auto& receipts=digestReceipts();
    if(!before.isEmpty()) {
        std::lock_guard lock(receipts.mutex);
        if(receipts.values.contains(key))return {true,true};
    }
    if(!file.seek(offset))return {};
    QCryptographicHash hash(QCryptographicHash::Sha256);
    qint64 remaining=count;
    while(remaining>0) {
        if(cancelled&&cancelled())return {};
        const auto chunk=file.read(std::min<qint64>(256*1024,remaining));
        if(chunk.isEmpty()||file.error()!=QFileDevice::NoError)return {};
        hash.addData(chunk);remaining-=chunk.size();
    }
    if(hash.result().toHex()!=expected.toLatin1()||(cancelled&&cancelled()))return {};
    const auto after=identity(file);
    if(before!=after)return {};
    if(!before.isEmpty()) {
        std::lock_guard lock(receipts.mutex);
        if(receipts.values.size()>=256)receipts.values.clear();
        receipts.values.insert(key,true);
    }
    return {true,false};
}
}

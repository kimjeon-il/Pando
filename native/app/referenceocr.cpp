#include "referenceocr.h"

#include <QBuffer>
#include <QRectF>
#include <algorithm>
#include <future>

#if defined(Q_OS_WIN) && defined(_MSC_VER) && __has_include(<winrt/Windows.Media.Ocr.h>)
#define PANDO_REFERENCE_WINDOWS_OCR 1
#include <winrt/base.h>
#include <winrt/Windows.Graphics.Imaging.h>
#include <winrt/Windows.Media.Ocr.h>
#include <winrt/Windows.Storage.Streams.h>
#else
#define PANDO_REFERENCE_WINDOWS_OCR 0
#endif

QVariantMap ReferenceOcrResult::toVariant() const
{
    return {{"available",available},{"ok",ok},{"reason",reason},{"provider",provider},{"detections",detections}};
}

ReferenceOcrResult detectReferenceImageTextNative(const QImage& source)
{
    if(source.isNull())return {false,false,QStringLiteral("invalid-image"),{},{}};
#if PANDO_REFERENCE_WINDOWS_OCR
    const QImage scaled=source.scaled(2048,2048,Qt::KeepAspectRatio,Qt::SmoothTransformation);
    return std::async(std::launch::async,[scaled] {
        ReferenceOcrResult output;output.available=true;output.provider=QStringLiteral("windows-media-ocr");
        try {
            winrt::init_apartment(winrt::apartment_type::multi_threaded);
            QByteArray encoded;QBuffer buffer(&encoded);buffer.open(QIODevice::WriteOnly);
            if(!scaled.save(&buffer,"PNG")){output.reason=QStringLiteral("ocr-image-encode-failed");return output;}

            using namespace winrt::Windows::Storage::Streams;
            using namespace winrt::Windows::Graphics::Imaging;
            using namespace winrt::Windows::Media::Ocr;
            InMemoryRandomAccessStream stream;
            DataWriter writer(stream);
            const auto* first=reinterpret_cast<const uint8_t*>(encoded.constData());
            writer.WriteBytes(winrt::array_view<uint8_t const>(first,first+encoded.size()));
            writer.StoreAsync().get();
            writer.DetachStream();
            stream.Seek(0);

            const auto decoder=BitmapDecoder::CreateAsync(stream).get();
            const auto bitmap=decoder.GetSoftwareBitmapAsync().get();
            const auto engine=OcrEngine::TryCreateFromUserProfileLanguages();
            if(!engine){output.available=false;output.reason=QStringLiteral("native-ocr-unavailable");return output;}
            const auto recognized=engine.RecognizeAsync(bitmap).get();
            int lineIndex=0;
            for(const auto& line:recognized.Lines()) {
                const auto raw=line.Text();
                const QString text=QString::fromWCharArray(raw.c_str(),int(raw.size())).trimmed();
                if(text.size()<2||text.size()>96)continue;
                QRectF bounds;bool hasBounds=false;
                for(const auto& word:line.Words()) {
                    const auto box=word.BoundingRect();
                    const QRectF rect(box.X,box.Y,box.Width,box.Height);
                    if(rect.isEmpty())continue;
                    bounds=hasBounds?bounds.united(rect):rect;hasBounds=true;
                }
                if(!hasBounds)continue;
                const double width=std::max(1,scaled.width()),height=std::max(1,scaled.height());
                const QVariantList normalizedBox{
                    std::clamp(bounds.x()/width,0.,1.),
                    std::clamp(bounds.y()/height,0.,1.),
                    std::clamp(bounds.width()/width,0.,1.),
                    std::clamp(bounds.height()/height,0.,1.)
                };
                output.detections.push_back(QVariantMap{
                    {"id",QStringLiteral("native-ocr-%1").arg(++lineIndex)},
                    {"text",text},
                    {"image",QVariantList{
                        std::clamp(bounds.center().x()/width,0.,1.),
                        std::clamp(bounds.center().y()/height,0.,1.)}},
                    {"box",normalizedBox},
                    {"confidence",1.0},
                    {"origin",QStringLiteral("windows-media-ocr")}
                });
            }
            output.ok=!output.detections.isEmpty();
            if(!output.ok)output.reason=QStringLiteral("no-ocr-text");
            return output;
        } catch(const winrt::hresult_error& error) {
            output.reason=QStringLiteral("native-ocr-failed:%1").arg(
                QString::fromWCharArray(error.message().c_str(),int(error.message().size())));
            return output;
        } catch(const std::exception& error) {
            output.reason=QStringLiteral("native-ocr-failed:%1").arg(QString::fromUtf8(error.what()));
            return output;
        }
    }).get();
#else
    return {false,false,QStringLiteral("native-ocr-unavailable"),{},{}};
#endif
}

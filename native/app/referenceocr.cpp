#include "referenceocr.h"

#include <QBuffer>
#include <QRectF>
#include <algorithm>
#include <future>

#if defined(Q_OS_WIN) && defined(_MSC_VER) && __has_include(<winrt/Windows.Media.Ocr.h>)
#define PANDO_REFERENCE_WINDOWS_OCR 1
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
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
            int detectionIndex=0;
            const double width=std::max(1,scaled.width()),height=std::max(1,scaled.height());
            const auto appendDetection=[&](const QString& text,const QRectF& bounds,const QString& origin,double confidence) {
                const auto trimmed=text.trimmed();
                if(trimmed.size()<2||trimmed.size()>96||bounds.isEmpty())return;
                const QVariantList normalizedBox{
                    std::clamp(bounds.x()/width,0.,1.),
                    std::clamp(bounds.y()/height,0.,1.),
                    std::clamp(bounds.width()/width,0.,1.),
                    std::clamp(bounds.height()/height,0.,1.)
                };
                output.detections.push_back(QVariantMap{
                    {"id",QStringLiteral("native-ocr-%1").arg(++detectionIndex)},
                    {"text",trimmed},
                    {"image",QVariantList{
                        std::clamp(bounds.center().x()/width,0.,1.),
                        std::clamp(bounds.center().y()/height,0.,1.)}},
                    {"box",normalizedBox},
                    {"confidence",confidence},
                    {"origin",origin}
                });
            };
            for(const auto& line:recognized.Lines()) {
                QRectF lineBounds;bool hasLineBounds=false;int wordCount=0;
                for(const auto& word:line.Words()) {
                    const auto rawWord=word.Text();
                    const QString wordText=QString::fromWCharArray(rawWord.c_str(),int(rawWord.size())).trimmed();
                    const auto box=word.BoundingRect();
                    const QRectF rect(box.X,box.Y,box.Width,box.Height);
                    if(rect.isEmpty())continue;
                    lineBounds=hasLineBounds?lineBounds.united(rect):rect;hasLineBounds=true;++wordCount;
                    appendDetection(wordText,rect,QStringLiteral("windows-media-ocr-word"),.96);
                }
                if(!hasLineBounds)continue;
                const auto rawLine=line.Text();
                const QString lineText=QString::fromWCharArray(rawLine.c_str(),int(rawLine.size())).trimmed();
                // Multi-word line detections preserve names such as "Bad Homburg";
                // single words are already emitted with the tighter word box.
                if(wordCount>1)appendDetection(lineText,lineBounds,QStringLiteral("windows-media-ocr-line"),.92);
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

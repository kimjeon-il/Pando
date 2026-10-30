#include <mupdf/fitz.h>
#include <mupdf/pdf.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

static unsigned char* read_input(size_t* length){
    size_t used=0,capacity=65536;unsigned char* data=(unsigned char*)malloc(capacity);
    if(!data)return NULL;
    for(;;){
        size_t count;
        if(used==capacity){
            unsigned char* next;
            if(capacity>=300u*1024u*1024u){free(data);return NULL;}
            capacity*=2;if(capacity>300u*1024u*1024u)capacity=300u*1024u*1024u;
            next=(unsigned char*)realloc(data,capacity);if(!next){free(data);return NULL;}data=next;
        }
        count=fread(data+used,1,capacity-used,stdin);used+=count;
        if(count==0){if(ferror(stdin)){free(data);return NULL;}break;}
    }
    *length=used;return data;
}
static fz_buffer* object_buffer(fz_context* ctx,pdf_obj* object){
    fz_buffer* buffer=NULL;fz_output* output=NULL;
    fz_var(buffer);fz_var(output);
    fz_try(ctx){
        buffer=fz_new_buffer(ctx,1024);output=fz_new_output_with_buffer(ctx,buffer);
        pdf_print_obj(ctx,output,object,1,1);fz_close_output(ctx,output);
    }
    fz_always(ctx){fz_drop_output(ctx,output);}
    fz_catch(ctx){fz_drop_buffer(ctx,buffer);fz_rethrow(ctx);}
    return buffer;
}
int main(int argc,char** argv){
    fz_context* ctx;fz_stream* stream=NULL;fz_document* document=NULL;fz_page* page=NULL;
    fz_pixmap* pixmap=NULL;fz_buffer* raw=NULL;fz_buffer* resolved=NULL;
    unsigned char* input;size_t input_size=0;int requested=0,status=1;
#ifdef _WIN32
    if(_setmode(_fileno(stdin),_O_BINARY)==-1||_setmode(_fileno(stdout),_O_BINARY)==-1)return 1;
#endif
    if(argc!=2){fprintf(stderr,"Expected 1-based PDF page or 0 for default\n");return 1;}
    {char* end=NULL;long n=strtol(argv[1],&end,10);if(!end||*end||n<0||n>1000000){fprintf(stderr,"Invalid PDF page\n");return 1;}requested=(int)n;}
    input=read_input(&input_size);if(!input){fprintf(stderr,"Unable to read PDF or input exceeds byte budget\n");return 1;}
    ctx=fz_new_context(NULL,NULL,FZ_STORE_DEFAULT);if(!ctx){free(input);fprintf(stderr,"MuPDF context unavailable\n");return 1;}
    fz_var(stream);fz_var(document);fz_var(page);fz_var(pixmap);fz_var(raw);fz_var(resolved);fz_var(status);
    fz_try(ctx){
        int count,width,height,rotation,stride,y,viewport_too_large=0;unsigned char *samples,*raw_bytes=NULL,*resolved_bytes=NULL;
        size_t raw_size=0,resolved_size=0;fz_rect bounds,crop;fz_matrix transform;pdf_document* pdf;pdf_page* pdfpage;pdf_obj *page_object,*vp;
        fz_register_document_handlers(ctx);stream=fz_open_memory(ctx,input,input_size);
        document=fz_open_document_with_stream(ctx,"application/pdf",stream);pdf=pdf_specifics(ctx,document);
        if(!pdf)fz_throw(ctx,FZ_ERROR_FORMAT,"Expected PDF document");
        count=fz_count_pages(ctx,document);
        if(count>1&&!requested)fz_throw(ctx,FZ_ERROR_ARGUMENT,"Multi-page PDF requires an explicit 1-based page");
        if(!requested)requested=1;
        if(requested>count)fz_throw(ctx,FZ_ERROR_ARGUMENT,"Invalid PDF page");
        page=fz_load_page(ctx,document,requested-1);bounds=fz_bound_page(ctx,page);
        if(!isfinite(bounds.x0)||!isfinite(bounds.x1)||!isfinite(bounds.y0)||!isfinite(bounds.y1)||
           bounds.x1<=bounds.x0||bounds.y1<=bounds.y0||ceil((bounds.x1-bounds.x0)*2)>16384||
           ceil((bounds.y1-bounds.y0)*2)>16384||ceil((bounds.x1-bounds.x0)*2)*ceil((bounds.y1-bounds.y0)*2)>16777216)
            fz_throw(ctx,FZ_ERROR_LIMIT,"Original PDF raster exceeds the 16MP graph budget");
        pdfpage=pdf_page_from_fz_page(ctx,page);pdf_page_transform(ctx,pdfpage,&crop,&transform);
        page_object=pdf_lookup_page_obj(ctx,pdf,requested-1);
        rotation=pdf_dict_get_inheritable_int(ctx,page_object,PDF_NAME(Rotate));rotation=((rotation%360)+360)%360;
        crop=pdf_dict_get_inheritable_rect(ctx,page_object,PDF_NAME(CropBox));
        if(fz_is_empty_rect(crop)||fz_is_infinite_rect(crop))crop=pdf_dict_get_inheritable_rect(ctx,page_object,PDF_NAME(MediaBox));
        vp=pdf_dict_gets(ctx,page_object,"VP");
        if(vp){
            raw=object_buffer(ctx,vp);raw_size=fz_buffer_storage(ctx,raw,&raw_bytes);
            if(raw_size>1000000){raw_size=0;viewport_too_large=1;}
            if(!viewport_too_large&&pdf_array_len(ctx,vp)==1&&pdf_is_indirect(ctx,pdf_array_get(ctx,vp,0))){
                resolved=object_buffer(ctx,pdf_resolve_indirect(ctx,pdf_array_get(ctx,vp,0)));
                resolved_size=fz_buffer_storage(ctx,resolved,&resolved_bytes);
            }
        }
        pixmap=fz_new_pixmap_from_page(ctx,page,fz_scale(2,2),fz_device_rgb(ctx),0);
        width=fz_pixmap_width(ctx,pixmap);height=fz_pixmap_height(ctx,pixmap);
        stride=fz_pixmap_stride(ctx,pixmap);samples=fz_pixmap_samples(ctx,pixmap);
        printf("{\"width\":%d,\"height\":%d,\"page\":%d,\"rotation\":%d,\"pageWidth\":%.9g,\"pageHeight\":%.9g,\"cropWidth\":%.9g,\"cropHeight\":%.9g,\"transform\":[%.9g,%.9g,%.9g,%.9g,%.9g,%.9g],\"rawBytes\":%zu,\"resolvedBytes\":%zu,\"viewportTooLarge\":%s}\n",
          width,height,requested,rotation,(double)(bounds.x1-bounds.x0),(double)(bounds.y1-bounds.y0),
          (double)fabs(crop.x1-crop.x0),(double)fabs(crop.y1-crop.y0),
          (double)transform.a,(double)transform.b,(double)transform.c,(double)transform.d,(double)transform.e,(double)transform.f,raw_size,resolved_size,viewport_too_large?"true":"false");
        if(raw_size&&fwrite(raw_bytes,1,raw_size,stdout)!=raw_size)fz_throw(ctx,FZ_ERROR_GENERIC,"Cannot write PDF metadata");
        if(resolved_size&&fwrite(resolved_bytes,1,resolved_size,stdout)!=resolved_size)fz_throw(ctx,FZ_ERROR_GENERIC,"Cannot write PDF metadata");
        for(y=0;y<height;y++)if(fwrite(samples+(size_t)y*stride,1,(size_t)width*3,stdout)!=(size_t)width*3)fz_throw(ctx,FZ_ERROR_GENERIC,"Cannot write PDF pixels");
        status=0;
    }
    fz_always(ctx){fz_drop_buffer(ctx,resolved);fz_drop_buffer(ctx,raw);fz_drop_pixmap(ctx,pixmap);fz_drop_page(ctx,page);fz_drop_document(ctx,document);fz_drop_stream(ctx,stream);}
    fz_catch(ctx){fprintf(stderr,"PDF input: %s\n",fz_caught_message(ctx));}
    fz_drop_context(ctx);free(input);return status;
}

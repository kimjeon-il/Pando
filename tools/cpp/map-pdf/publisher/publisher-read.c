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

/* Read an acquired original once; output never modifies the PDF. */
static unsigned char *read_input(size_t *length){
    const size_t limit=300u*1024u*1024u;size_t used=0,capacity=65536;unsigned char *data=(unsigned char*)malloc(capacity);
    if(!data)return NULL;
    for(;;){size_t count;if(used==capacity){unsigned char *next;if(capacity>=limit){free(data);return NULL;}
        capacity*=2;if(capacity>limit)capacity=limit;next=(unsigned char*)realloc(data,capacity);
        if(!next){free(data);return NULL;}data=next;}
        count=fread(data+used,1,capacity-used,stdin);used+=count;
        if(!count){if(ferror(stdin)){free(data);return NULL;}break;}}
    *length=used;return data;
}
static void json_string(const char *value){
    const unsigned char *s=(const unsigned char*)(value?value:"");putchar('"');
    for(;*s;s++){if(*s=='"'||*s=='\\'){putchar('\\');putchar(*s);}else if(*s<32)printf("\\u%04x",(unsigned)*s);else putchar(*s);}
    putchar('"');
}
int main(int argc,char **argv){
    fz_context *ctx=NULL;fz_stream *stream=NULL;fz_document *document=NULL;fz_page *page=NULL;fz_pixmap *pixmap=NULL;
    unsigned char *input=NULL;size_t input_size=0;int status=1,render=0,maximum=0;
#ifdef _WIN32
    if(_setmode(_fileno(stdin),_O_BINARY)==-1||_setmode(_fileno(stdout),_O_BINARY)==-1)return 1;
#endif
    if(argc==2&&!strcmp(argv[1],"inspect"))render=0;
    else if(argc==4&&!strcmp(argv[1],"render")){char *end=NULL;long value=strtol(argv[2],&end,10);
        if(!end||*end||value<32||value>4096){fprintf(stderr,"Invalid maximum dimension\n");return 1;}
        render=1;maximum=(int)value;}
    else{fprintf(stderr,"Expected inspect or render MAX_DIMENSION LAYER_BITS\n");return 1;}
    input=read_input(&input_size);if(!input){fprintf(stderr,"Unable to read PDF or input exceeds budget\n");return 1;}
    ctx=fz_new_context(NULL,NULL,FZ_STORE_DEFAULT);if(!ctx){free(input);fprintf(stderr,"MuPDF context unavailable\n");return 1;}
    fz_var(stream);fz_var(document);fz_var(page);fz_var(pixmap);fz_var(status);
    fz_try(ctx){
        pdf_document *pdf;pdf_obj *object;int count,rotation,layers,i;
        fz_register_document_handlers(ctx);stream=fz_open_memory(ctx,input,input_size);
        document=fz_open_document_with_stream(ctx,"application/pdf",stream);pdf=pdf_specifics(ctx,document);
        if(!pdf)fz_throw(ctx,FZ_ERROR_FORMAT,"Expected PDF document");
        count=fz_count_pages(ctx,document);if(count!=1)fz_throw(ctx,FZ_ERROR_ARGUMENT,"Single publisher PDF page required");
        object=pdf_lookup_page_obj(ctx,pdf,0);rotation=pdf_dict_get_inheritable_int(ctx,object,PDF_NAME(Rotate));rotation=((rotation%360)+360)%360;
        if(rotation)fz_throw(ctx,FZ_ERROR_ARGUMENT,"Unrotated publisher PDF page required");
        layers=pdf_count_layers(ctx,pdf);if(layers<1||layers>1024)fz_throw(ctx,FZ_ERROR_LIMIT,"Bounded publisher layers required");
        if(!render){int entries=pdf_count_layer_config_ui(ctx,pdf);
            if(entries<0||entries>4096)fz_throw(ctx,FZ_ERROR_LIMIT,"Publisher layer UI exceeds budget");
            printf("{\"pageCount\":%d,\"rotation\":%d,\"layers\":[",count,rotation);
            for(i=0;i<layers;i++){if(i)putchar(',');printf("{\"name\":");json_string(pdf_layer_name(ctx,pdf,i));
                printf(",\"enabled\":%s}",pdf_layer_is_enabled(ctx,pdf,i)?"true":"false");}
            printf("],\"ui\":[");
            for(i=0;i<entries;i++){pdf_layer_config_ui info;pdf_layer_config_ui_info(ctx,pdf,i,&info);
                if(i)putchar(',');printf("{\"text\":");json_string(info.text);printf(",\"depth\":%d,\"type\":%d}",info.depth,(int)info.type);}
            printf("]}\n");
        }else{fz_rect bounds;fz_matrix scale;int width,height,stride,y;unsigned char *samples;double factor;
            if(strlen(argv[3])!=(size_t)layers)fz_throw(ctx,FZ_ERROR_ARGUMENT,"Layer bit count differs");
            for(i=0;i<layers;i++){if(argv[3][i]!='0'&&argv[3][i]!='1')fz_throw(ctx,FZ_ERROR_ARGUMENT,"Invalid layer selection");
                pdf_enable_layer(ctx,pdf,i,argv[3][i]=='1');}
            page=fz_load_page(ctx,document,0);bounds=fz_bound_page(ctx,page);
            if(!isfinite(bounds.x0)||!isfinite(bounds.y0)||!isfinite(bounds.x1)||!isfinite(bounds.y1)||bounds.x1<=bounds.x0||bounds.y1<=bounds.y0)
                fz_throw(ctx,FZ_ERROR_FORMAT,"Invalid publisher page dimensions");
            factor=maximum/fmax((double)(bounds.x1-bounds.x0),(double)(bounds.y1-bounds.y0));
            scale=fz_scale((float)factor,(float)factor);pixmap=fz_new_pixmap_from_page(ctx,page,scale,fz_device_rgb(ctx),0);
            width=fz_pixmap_width(ctx,pixmap);height=fz_pixmap_height(ctx,pixmap);stride=fz_pixmap_stride(ctx,pixmap);samples=fz_pixmap_samples(ctx,pixmap);
            if(width<1||height<1||width>4096||height>4096||(size_t)width*(size_t)height>16777216)
                fz_throw(ctx,FZ_ERROR_LIMIT,"Publisher raster exceeds budget");
            printf("{\"width\":%d,\"height\":%d,\"scale\":%.17g}\n",width,height,factor);
            for(y=0;y<height;y++)if(fwrite(samples+(size_t)y*stride,1,(size_t)width*3,stdout)!=(size_t)width*3)
                fz_throw(ctx,FZ_ERROR_GENERIC,"Cannot write publisher raster");
        }
        status=0;
    }
    fz_always(ctx){fz_drop_pixmap(ctx,pixmap);fz_drop_page(ctx,page);fz_drop_document(ctx,document);fz_drop_stream(ctx,stream);}
    fz_catch(ctx){fprintf(stderr,"Publisher PDF: %s\n",fz_caught_message(ctx));}
    fz_drop_context(ctx);free(input);return status;
}

#include <mupdf/fitz.h>
#include <mupdf/pdf.h>
#include <float.h>
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
    for(;;){size_t count;if(used==capacity){unsigned char *next;if(capacity>=limit){int extra=fgetc(stdin);if(extra==EOF&&!ferror(stdin))break;free(data);return NULL;}
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
static int mask_operation(const char *action,const char *width_text,const char *height_text,const char *bits_text,unsigned char *input,size_t size){
    char *end=NULL;long width=strtol(width_text,&end,10),height,bits;size_t pixels,i;int channel;
    if(!end||*end||width<1||width>4096)return 1;
    height=strtol(height_text,&end,10);if(!end||*end||height<1||height>4096)return 1;
    bits=strtol(bits_text,&end,10);if(!end||*end||bits<1||bits>127)return 1;
    pixels=(size_t)width*(size_t)height;
    if(!strcmp(action,"rgba")){
        unsigned char *output;if(size!=pixels*3||bits!=1)return 1;
        output=(unsigned char*)malloc(pixels*4);if(!output)return 1;
        for(i=0;i<pixels;i++){output[i*4]=input[i*3];output[i*4+1]=input[i*3+1];output[i*4+2]=input[i*3+2];output[i*4+3]=255;}
        i=fwrite(output,1,pixels*4,stdout);free(output);return i==pixels*4?0:1;
    }
    if(!strcmp(action,"compare")){
        const unsigned char *text,*before,*after;if(size!=pixels*8||!(bits==1||bits==2||bits==8||bits==16||bits==64))return 1;
        text=input+pixels;before=input+pixels*2;after=input+pixels*5;
        for(i=0;i<pixels;i++){int delta=0;if(text[i]>1||input[i]>127)return 1;
            for(channel=0;channel<3;channel++){int d=abs((int)after[i*3+channel]-(int)before[i*3+channel]);if(d>delta)delta=d;}
            if(!text[i]&&delta>8)input[i]|=(unsigned char)bits;}
        return fwrite(input,1,pixels,stdout)==pixels?0:1;
    }
    if(!strcmp(action,"finish")){
        size_t positive[7]={0,0,0,0,0,0,0};unsigned char *valid;
        if(size!=pixels*2||!(bits&32))return 1;
        valid=input+pixels;
        for(i=0;i<pixels;i++){unsigned char text=valid[i];if(text>1||input[i]>127||(input[i]&~bits))return 1;
            if(text){if(input[i])return 1;input[i]=32;valid[i]=32;}else valid[i]=(unsigned char)bits;
            for(channel=0;channel<7;channel++)if(input[i]&(1<<channel))positive[channel]++;}
        printf("{\"positivePixels\":[%zu,%zu,%zu,%zu,%zu,%zu,%zu]}\n",positive[0],positive[1],positive[2],positive[3],positive[4],positive[5],positive[6]);
        return fwrite(input,1,pixels*2,stdout)==pixels*2?0:1;
    }
    return 1;
}
typedef struct {
    fz_device base;
    unsigned char *mask;
    int width,height;
    double scale;
    size_t characters;
    int include_all_layers;
    char layer[4097];
} publisher_text_device;
static int unicode_space(int c){
    return (c>=9&&c<=13)||(c>=0x1c&&c<=0x20)||c==0x85||c==0xa0||c==0x1680||
        (c>=0x2000&&c<=0x200a)||c==0x2028||c==0x2029||c==0x202f||c==0x205f||c==0x3000;
}
static void begin_text_layer(fz_context *ctx,fz_device *device,const char *name){
    publisher_text_device *self=(publisher_text_device*)device;size_t length=name?strlen(name):0;
    if(length>=sizeof(self->layer))fz_throw(ctx,FZ_ERROR_LIMIT,"Publisher text layer name exceeds budget");
    if(length)memcpy(self->layer,name,length);self->layer[length]='\0';
}
static void end_text_layer(fz_context *ctx,fz_device *device){(void)ctx;((publisher_text_device*)device)->layer[0]='\0';}
static void trace_text(fz_context *ctx,publisher_text_device *self,const fz_text *text,fz_matrix ctm,float alpha){
    const fz_text_span *span;
    if(alpha<=0||(!self->include_all_layers&&(!strcmp(self->layer,"Orthoimage")||!strcmp(self->layer,"Shaded Relief"))))return;
    for(span=text->head;span;span=span->next){
        fz_matrix mat=fz_concat(span->trm,ctm),rotation;fz_point dir=fz_transform_vector(fz_make_point(1,0),mat);
        double size=sqrt((double)dir.x*dir.x+(double)dir.y*dir.y),asc=fz_font_ascender(ctx,span->font),desc=fz_font_descender(ctx,span->font);
        double ascsize,descsize;int i;if(asc<1e-3){asc=.9;desc=-.1;}if(asc==desc)fz_throw(ctx,FZ_ERROR_FORMAT,"Invalid publisher font metrics");
        ascsize=asc*size/(asc-desc);descsize=desc*size/(asc-desc);dir=fz_normalize_vector(dir);
        rotation=fz_make_matrix(dir.x,dir.y,-dir.y,dir.x,0,0);if(dir.x==-1)rotation.d=1;
        for(i=0;i<span->len;i++){
            const fz_text_item *item=&span->items[i];fz_point origin;fz_matrix move;fz_rect box;double advance=0,x0,x1,y0,y1;
            int left,right,top,bottom,x,y;
            if(item->ucs<0||item->ucs>0x10ffff)fz_throw(ctx,FZ_ERROR_FORMAT,"Invalid publisher text character");
            if(unicode_space(item->ucs))continue;
            if(++self->characters>10000000)fz_throw(ctx,FZ_ERROR_LIMIT,"Publisher text exceeds character budget");
            if(item->gid>=0)advance=fz_advance_glyph(ctx,span->font,item->gid,span->wmode);advance*=size;
            origin=fz_transform_point(fz_make_point(item->x,item->y),ctm);
            move=fz_concat(fz_translate(-origin.x,-origin.y),rotation);move=fz_concat(move,fz_translate(origin.x,origin.y));
            x0=origin.x;x1=x0+advance;
            if((mat.d>0&&(dir.x==1||dir.x==-1))||(mat.b!=0&&mat.b==-mat.c)){y0=origin.y+descsize;y1=origin.y+ascsize;}
            else{y0=origin.y-ascsize;y1=origin.y-descsize;}
            box=fz_transform_rect(fz_make_rect((float)x0,(float)y0,(float)x1,(float)y1),move);
            if(!isfinite(box.x0)||!isfinite(box.y0)||!isfinite(box.x1)||!isfinite(box.y1)||box.x1<=box.x0||box.y1<=box.y0)continue;
            x0=floor(box.x0*self->scale)-1;x1=ceil(box.x1*self->scale)+1;y0=floor(box.y0*self->scale)-1;y1=ceil(box.y1*self->scale)+1;
            if(x1<0||y1<0||x0>=self->width||y0>=self->height)continue;
            left=(int)fmax(0,x0);right=(int)fmin(self->width-1,x1);top=(int)fmax(0,y0);bottom=(int)fmin(self->height-1,y1);
            for(y=top;y<=bottom;y++)for(x=left;x<=right;x++)self->mask[(size_t)y*self->width+x]=1;
        }
    }
}
static void fill_text(fz_context *ctx,fz_device *device,const fz_text *text,fz_matrix ctm,fz_colorspace *space,const float *color,float alpha,fz_color_params params){
    (void)space;(void)color;(void)params;trace_text(ctx,(publisher_text_device*)device,text,ctm,alpha);
}
static void stroke_text(fz_context *ctx,fz_device *device,const fz_text *text,const fz_stroke_state *stroke,fz_matrix ctm,fz_colorspace *space,const float *color,float alpha,fz_color_params params){
    (void)stroke;(void)space;(void)color;(void)params;trace_text(ctx,(publisher_text_device*)device,text,ctm,alpha);
}
typedef struct {double color[3],width,dash[32];int dash_len;} macro_signature;
typedef struct {fz_device base;fz_device *draw;macro_signature signatures[64];int count,selected;} macro_stroke_device;
static int macro_number(const char **cursor,double *result){char *end;double number=strtod(*cursor,&end);
    if(end==*cursor||!isfinite(number))return 0;*cursor=end;*result=number;return 1;}
static int macro_signatures(macro_stroke_device *dev,const char *value){
    while(*value){macro_signature *s;double n;int i;if(dev->count>=64)return 0;s=&dev->signatures[dev->count++];
        for(i=0;i<3;i++){if(!macro_number(&value,&s->color[i])||s->color[i]<0||s->color[i]>1||*value++!=',')return 0;}
        if(!macro_number(&value,&s->width)||s->width<0||*value++!=','||!macro_number(&value,&n)||n<0||n>32||floor(n)!=n)return 0;
        s->dash_len=(int)n;for(i=0;i<s->dash_len;i++){if(*value++!=','||!macro_number(&value,&s->dash[i])||s->dash[i]<0)return 0;}
        if(*value==';')value++;else if(*value)return 0;
    }return dev->count>0;
}
static void macro_stroke_path(fz_context *ctx,fz_device *device,const fz_path *path,const fz_stroke_state *stroke,fz_matrix ctm,
                             fz_colorspace *space,const float *color,float alpha,fz_color_params params){
    macro_stroke_device *self=(macro_stroke_device*)device;float rgb[3],black[1]={0},factor=1;int i,j;
    (void)alpha;if(!space||!color)return;fz_convert_color(ctx,space,color,fz_device_rgb(ctx),rgb,NULL,params);
    /* Match the original line-art extraction: paths are transformed into page
     * coordinates, while widths and dashes use its recorded path factor. */
    if(ctm.a!=0&&fabs(ctm.a)==fabs(ctm.d))factor=fabsf(ctm.a);
    else if(ctm.b!=0&&fabs(ctm.b)==fabs(ctm.c))factor=fabsf(ctm.b);
    for(i=0;i<self->count;i++){const macro_signature *s=&self->signatures[i];
        if(stroke->dash_len!=s->dash_len||fabs(factor*stroke->linewidth-s->width)>.001)continue;
        for(j=0;j<3;j++)if(fabs(rgb[j]-s->color[j])>.0001)break;if(j!=3)continue;
        for(j=0;j<s->dash_len;j++)if(fabs(factor*stroke->dash_list[j]-s->dash[j])>.001)break;if(j!=s->dash_len)continue;
        {fz_path *transformed=NULL;fz_stroke_state *copy=NULL;int cap=(int)stroke->start_cap;
            fz_var(transformed);fz_var(copy);
            fz_try(ctx){
                transformed=fz_clone_path(ctx,(fz_path*)path);fz_transform_path(ctx,transformed,ctm);
                copy=fz_new_stroke_state_with_dash_len(ctx,stroke->dash_len);copy->linewidth=factor*stroke->linewidth;
                if((int)stroke->dash_cap>cap)cap=(int)stroke->dash_cap;if((int)stroke->end_cap>cap)cap=(int)stroke->end_cap;
                copy->start_cap=copy->dash_cap=copy->end_cap=(fz_linecap)cap;copy->linejoin=stroke->linejoin;
                copy->miterlimit=stroke->miterlimit;copy->dash_phase=factor*stroke->dash_phase;copy->dash_len=stroke->dash_len;
                for(j=0;j<stroke->dash_len;j++)copy->dash_list[j]=factor*stroke->dash_list[j];
                self->selected++;fz_stroke_path(ctx,self->draw,transformed,copy,fz_make_matrix(1,0,0,1,0,0),fz_device_gray(ctx),black,1,params);
            }fz_always(ctx){fz_drop_path(ctx,transformed);fz_drop_stroke_state(ctx,copy);}
            fz_catch(ctx){fz_rethrow(ctx);}}
        return;
    }
}
static fz_rect credit_character_bounds(fz_context *ctx,const fz_stext_line *line,const fz_stext_char *ch){
    fz_quad quad=ch->quad;float asc=fz_font_ascender(ctx,ch->font),desc=fz_font_descender(ctx,ch->font),range=asc-desc+FLT_EPSILON;
    if(!line->wmode&&range<1){
        float c=line->dir.x,s=line->dir.y,size=ch->size;fz_matrix undo=fz_make_matrix(c,-s,s,c,0,0),redo=fz_make_matrix(c,s,-s,c,0,0);
        if(asc<1e-3f){asc=.9f;desc=-.1f;range=1;}asc/=range;desc/=range;range=asc-desc;asc=asc*size/range;desc=desc*size/range;
        if(c==-1){undo.d=1;redo.d=1;}
        quad=fz_transform_quad(quad,fz_translate(-ch->origin.x,-ch->origin.y));quad=fz_transform_quad(quad,undo);
        if(c==1&&quad.ul.y>0){quad.ul.y=quad.ur.y=asc;quad.ll.y=quad.lr.y=desc;}
        else{quad.ul.y=quad.ur.y=-asc;quad.ll.y=quad.lr.y=-desc;}
        if(quad.ll.x<0)quad.ll.x=quad.ul.x=0;
        if(quad.lr.x-quad.ll.x<FLT_EPSILON){int glyph=fz_encode_character(ctx,ch->font,ch->c);
            if(glyph){quad.lr.x=quad.ll.x+fz_advance_glyph(ctx,ch->font,glyph,line->wmode)*size;quad.ur.x=quad.lr.x;}}
        quad=fz_transform_quad(quad,redo);quad=fz_transform_quad(quad,fz_translate(ch->origin.x,ch->origin.y));
    }
    {fz_rect box=fz_rect_from_quad(quad);if(line->wmode&&box.y1<box.y0+ch->size)box.y0=box.y1-ch->size;return box;}
}
static void append_credits(fz_context *ctx,fz_buffer *buffer,const fz_stext_page *page){
    const fz_stext_block *block;size_t count=0;
    for(block=page->first_block;block;block=block->next)if(block->type==FZ_STEXT_BLOCK_TEXT){const fz_stext_line *line;
        for(line=block->u.t.first_line;line;line=line->next){const fz_stext_char *ch;int last=0;
            for(ch=line->first_char;ch;ch=ch->next){fz_rect r=credit_character_bounds(ctx,line,ch),page_rect=page->mediabox;
                if(fz_is_infinite_rect(page_rect)||(page_rect.x0<r.x1&&page_rect.y0<r.y1&&page_rect.x1>r.x0&&page_rect.y1>r.y0)){
                    last=ch->c;fz_append_rune(ctx,buffer,last);if((++count&4095)==0){unsigned char *data=NULL;
                        if(fz_buffer_storage(ctx,buffer,&data)>8u*1024u*1024u)fz_throw(ctx,FZ_ERROR_LIMIT,"Publisher credits exceed budget");}}}
            if(last!=10&&last>0)fz_append_byte(ctx,buffer,'\n');}}
}
int main(int argc,char **argv){
    fz_context *ctx=NULL;fz_stream *stream=NULL;fz_document *document=NULL;fz_page *page=NULL;fz_pixmap *pixmap=NULL;
    fz_display_list *display_list=NULL;fz_device *draw_device=NULL;
    fz_buffer *configured=NULL;fz_output *configured_output=NULL;fz_stream *configured_stream=NULL;fz_document *configured_document=NULL;
    fz_device *text_device=NULL,*stroke_device=NULL;fz_stext_page *text_page=NULL;fz_buffer *credits=NULL;
    unsigned char *input=NULL,*mask=NULL;size_t input_size=0;int status=1,render=0,maximum=0,mask_mode=0;
#ifdef _WIN32
    if(_setmode(_fileno(stdin),_O_BINARY)==-1||_setmode(_fileno(stdout),_O_BINARY)==-1)return 1;
#endif
    if(argc==5&&(!strcmp(argv[1],"compare")||!strcmp(argv[1],"finish")||!strcmp(argv[1],"rgba")))mask_mode=1;
    else if(argc==2&&!strcmp(argv[1],"inspect"))render=0;
    else if((argc==4&&(!strcmp(argv[1],"render")||!strcmp(argv[1],"macro-stroke")))||(argc==3&&(!strcmp(argv[1],"text")||!strcmp(argv[1],"macro-render")||!strcmp(argv[1],"macro-text")))){char *end=NULL;long value=strtol(argv[2],&end,10);
        if(!end||*end||value<32||value>4096){fprintf(stderr,"Invalid maximum dimension\n");return 1;}
        render=!strcmp(argv[1],"macro-stroke")?5:argc==4?1:!strcmp(argv[1],"macro-render")?3:!strcmp(argv[1],"macro-text")?4:2;maximum=(int)value;}
    else{fprintf(stderr,"Expected inspect, text MAX_DIMENSION or render MAX_DIMENSION LAYER_BITS\n");return 1;}
    input=read_input(&input_size);if(!input){fprintf(stderr,"Unable to read PDF or input exceeds budget\n");return 1;}
    if(mask_mode){status=mask_operation(argv[1],argv[2],argv[3],argv[4],input,input_size);free(input);
        if(status)fprintf(stderr,"Invalid publisher mask input\n");return status;}
    ctx=fz_new_context(NULL,NULL,FZ_STORE_DEFAULT);if(!ctx){free(input);fprintf(stderr,"MuPDF context unavailable\n");return 1;}
    fz_var(stream);fz_var(document);fz_var(page);fz_var(pixmap);fz_var(display_list);fz_var(draw_device);fz_var(configured);fz_var(configured_output);fz_var(configured_stream);fz_var(configured_document);
    fz_var(text_device);fz_var(stroke_device);fz_var(text_page);fz_var(credits);fz_var(mask);fz_var(status);
    fz_try(ctx){
        pdf_document *pdf;pdf_obj *object;int count,rotation,layers,i;
        fz_register_document_handlers(ctx);stream=fz_open_memory(ctx,input,input_size);
        document=fz_open_document_with_stream(ctx,"application/pdf",stream);pdf=pdf_specifics(ctx,document);
        if(!pdf)fz_throw(ctx,FZ_ERROR_FORMAT,"Expected PDF document");
        count=fz_count_pages(ctx,document);if(count!=1)fz_throw(ctx,FZ_ERROR_ARGUMENT,"Single publisher PDF page required");
        object=pdf_lookup_page_obj(ctx,pdf,0);rotation=pdf_dict_get_inheritable_int(ctx,object,PDF_NAME(Rotate));rotation=((rotation%360)+360)%360;
        if(rotation&&render<3)fz_throw(ctx,FZ_ERROR_ARGUMENT,"Unrotated publisher PDF page required");
        if(render>=3&&rotation%90)fz_throw(ctx,FZ_ERROR_ARGUMENT,"Unsupported macro page rotation");
        layers=pdf_count_layers(ctx,pdf);if(layers>1024||(layers<1&&render<3))fz_throw(ctx,FZ_ERROR_LIMIT,"Bounded publisher layers required");
        if(!render){int entries=pdf_count_layer_config_ui(ctx,pdf);fz_rect bounds;
            if(entries<0||entries>4096)fz_throw(ctx,FZ_ERROR_LIMIT,"Publisher layer UI exceeds budget");
            page=fz_load_page(ctx,document,0);bounds=fz_bound_page(ctx,page);
            if(!isfinite(bounds.x0)||!isfinite(bounds.y0)||!isfinite(bounds.x1)||!isfinite(bounds.y1)||bounds.x1<=bounds.x0||bounds.y1<=bounds.y0)
                fz_throw(ctx,FZ_ERROR_FORMAT,"Invalid publisher page dimensions");
            printf("{\"pageCount\":%d,\"rotation\":%d,\"sourceRectPts\":[%.9g,%.9g,%.9g,%.9g],\"layers\":[",count,rotation,
                (double)bounds.x0,(double)bounds.y0,(double)bounds.x1,(double)bounds.y1);
            for(i=0;i<layers;i++){if(i)putchar(',');printf("{\"name\":");json_string(pdf_layer_name(ctx,pdf,i));
                printf(",\"enabled\":%s}",pdf_layer_is_enabled(ctx,pdf,i)?"true":"false");}
            printf("],\"ui\":[");
            for(i=0;i<entries;i++){pdf_layer_config_ui info;pdf_layer_config_ui_info(ctx,pdf,i,&info);
                if(i)putchar(',');printf("{\"text\":");json_string(info.text);printf(",\"depth\":%d,\"type\":%d}",info.depth,(int)info.type);}
            printf("]}\n");
        }else{fz_rect bounds;fz_matrix scale;fz_irect pixel_bounds;int width,height,stride,y;unsigned char *samples;double factor;
            if(render==1&&strlen(argv[3])!=(size_t)layers)fz_throw(ctx,FZ_ERROR_ARGUMENT,"Layer bit count differs");
            for(i=0;i<layers&&render<3;i++){if(render==1&&argv[3][i]!='0'&&argv[3][i]!='1')fz_throw(ctx,FZ_ERROR_ARGUMENT,"Invalid layer selection");
                pdf_enable_layer(ctx,pdf,i,render==2||argv[3][i]=='1');}
            /* Persist only in memory, then reopen so PDF optional-content
             * membership expressions observe the requested default state. */
            if(render<3){pdf_write_options options={0};unsigned char *bytes=NULL;size_t length;
                options.do_encrypt=PDF_ENCRYPT_NONE;options.permissions=4095;options.do_preserve_metadata=1;
                pdf_set_layer_config_as_default(ctx,pdf);configured=fz_new_buffer(ctx,input_size);
                configured_output=fz_new_output_with_buffer(ctx,configured);pdf_write_document(ctx,pdf,configured_output,&options);fz_close_output(ctx,configured_output);
                length=fz_buffer_storage(ctx,configured,&bytes);if(!length||length>300u*1024u*1024u)fz_throw(ctx,FZ_ERROR_LIMIT,"Configured publisher PDF exceeds budget");
                configured_stream=fz_open_memory(ctx,bytes,length);configured_document=fz_open_document_with_stream(ctx,"application/pdf",configured_stream);}
            if(render>=3){pdf_dict_put_int(ctx,object,PDF_NAME(Rotate),0);page=fz_load_page(ctx,document,0);}
            else page=fz_load_page(ctx,configured_document,0);
            bounds=fz_bound_page(ctx,page);
            if(!isfinite(bounds.x0)||!isfinite(bounds.y0)||!isfinite(bounds.x1)||!isfinite(bounds.y1)||bounds.x1<=bounds.x0||bounds.y1<=bounds.y0)
                fz_throw(ctx,FZ_ERROR_FORMAT,"Invalid publisher page dimensions");
            factor=maximum/fmax((double)bounds.x1-(double)bounds.x0,(double)bounds.y1-(double)bounds.y0);
            scale=fz_scale((float)factor,(float)factor);display_list=fz_new_display_list_from_page(ctx,page);
            pixel_bounds=fz_round_rect(fz_transform_rect(fz_bound_display_list(ctx,display_list),scale));
            width=pixel_bounds.x1-pixel_bounds.x0;height=pixel_bounds.y1-pixel_bounds.y0;
            if(width<1||height<1||width>4096||height>4096||(size_t)width*(size_t)height>16777216)
                fz_throw(ctx,FZ_ERROR_LIMIT,"Publisher raster exceeds budget");
            if(render==1||render==3){
                fz_rect infinite=fz_make_rect((float)FZ_MIN_INF_RECT,(float)FZ_MIN_INF_RECT,(float)FZ_MAX_INF_RECT,(float)FZ_MAX_INF_RECT);
                pixmap=fz_new_pixmap_with_bbox(ctx,fz_device_rgb(ctx),pixel_bounds,NULL,0);fz_clear_pixmap_with_value(ctx,pixmap,255);
                draw_device=fz_new_draw_device(ctx,scale,pixmap);fz_run_display_list(ctx,display_list,draw_device,fz_make_matrix(1,0,0,1,0,0),infinite,NULL);
                fz_close_device(ctx,draw_device);stride=fz_pixmap_stride(ctx,pixmap);samples=fz_pixmap_samples(ctx,pixmap);
                printf("{\"width\":%d,\"height\":%d,\"scale\":%.17g,\"rotation\":%d}\n",width,height,factor,rotation);
                for(y=0;y<height;y++)if(fwrite(samples+(size_t)y*stride,1,(size_t)width*3,stdout)!=(size_t)width*3)
                    fz_throw(ctx,FZ_ERROR_GENERIC,"Cannot write publisher raster");
            }else if(render==5){macro_stroke_device *trace;int x;
                pixmap=fz_new_pixmap_with_bbox(ctx,fz_device_gray(ctx),pixel_bounds,NULL,0);fz_clear_pixmap_with_value(ctx,pixmap,255);
                draw_device=fz_new_draw_device(ctx,scale,pixmap);trace=fz_new_derived_device(ctx,macro_stroke_device);stroke_device=&trace->base;
                trace->draw=draw_device;trace->count=0;trace->selected=0;trace->base.stroke_path=macro_stroke_path;
                if(strlen(argv[3])>65536||!macro_signatures(trace,argv[3]))fz_throw(ctx,FZ_ERROR_ARGUMENT,"Invalid macro stroke signatures");
                fz_run_page(ctx,page,stroke_device,fz_make_matrix(1,0,0,1,0,0),NULL);fz_close_device(ctx,stroke_device);fz_close_device(ctx,draw_device);
                if(!trace->selected)fz_throw(ctx,FZ_ERROR_ARGUMENT,"Catalogued macro boundary stroke is absent");
                stride=fz_pixmap_stride(ctx,pixmap);samples=fz_pixmap_samples(ctx,pixmap);
                printf("{\"width\":%d,\"height\":%d,\"scale\":%.17g,\"rotation\":%d,\"selected\":%d}\n",width,height,factor,rotation,trace->selected);
                for(y=0;y<height;y++)for(x=0;x<width;x++)if(putchar(samples[(size_t)y*stride+x]<247?1:0)==EOF)
                    fz_throw(ctx,FZ_ERROR_GENERIC,"Cannot write macro stroke mask");
            }else{publisher_text_device *trace;unsigned char *credit_bytes=NULL;size_t credit_size;fz_stext_options text_options={0};
                mask=(unsigned char*)calloc((size_t)width*height,1);if(!mask)fz_throw(ctx,FZ_ERROR_SYSTEM,"Publisher text allocation failed");
                trace=fz_new_derived_device(ctx,publisher_text_device);text_device=&trace->base;
                trace->mask=mask;trace->width=width;trace->height=height;trace->scale=factor;trace->characters=0;trace->include_all_layers=render==4;trace->layer[0]='\0';
                trace->base.fill_text=fill_text;trace->base.stroke_text=stroke_text;trace->base.begin_layer=begin_text_layer;trace->base.end_layer=end_text_layer;
                fz_run_page(ctx,page,text_device,fz_make_matrix(1,0,0,1,0,0),NULL);fz_close_device(ctx,text_device);
                text_options.flags=FZ_STEXT_PRESERVE_LIGATURES|FZ_STEXT_PRESERVE_WHITESPACE|FZ_STEXT_MEDIABOX_CLIP|FZ_STEXT_USE_CID_FOR_UNKNOWN_UNICODE;
                text_page=fz_new_stext_page_from_page(ctx,page,&text_options);credits=fz_new_buffer(ctx,1024);append_credits(ctx,credits,text_page);
                credit_size=fz_buffer_storage(ctx,credits,&credit_bytes);if(credit_size>8u*1024u*1024u)fz_throw(ctx,FZ_ERROR_LIMIT,"Publisher credits exceed budget");
                printf("{\"width\":%d,\"height\":%d,\"scale\":%.17g,\"rotation\":%d,\"creditBytes\":%zu,\"characters\":%zu}\n",width,height,factor,rotation,credit_size,trace->characters);
                if(fwrite(credit_bytes,1,credit_size,stdout)!=credit_size||fwrite(mask,1,(size_t)width*height,stdout)!=(size_t)width*height)
                    fz_throw(ctx,FZ_ERROR_GENERIC,"Cannot write publisher text evidence");
            }
        }
        status=0;
    }
    fz_always(ctx){fz_drop_buffer(ctx,credits);fz_drop_stext_page(ctx,text_page);fz_drop_device(ctx,text_device);fz_drop_device(ctx,stroke_device);free(mask);
        fz_drop_device(ctx,draw_device);fz_drop_pixmap(ctx,pixmap);fz_drop_display_list(ctx,display_list);fz_drop_page(ctx,page);fz_drop_document(ctx,configured_document);fz_drop_stream(ctx,configured_stream);
        fz_drop_output(ctx,configured_output);fz_drop_buffer(ctx,configured);fz_drop_document(ctx,document);fz_drop_stream(ctx,stream);}
    fz_catch(ctx){fprintf(stderr,"Publisher PDF: %s\n",fz_caught_message(ctx));}
    fz_drop_context(ctx);free(input);return status;
}

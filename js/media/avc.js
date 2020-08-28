
function SBPAvc() {
}

SBPAvc.parseSps = function(data, offset, length, info) {

    var sps = {};
    var br = new SBPBitReader(data, offset, length);
    var i, j;

    info.profile = br.readU(8);
    br.skip(8);
    info.level = br.readU(8);
    br.skipUE();

    if (info.profile === 100 || info.profile === 110 || info.profile === 122 || info.profile === 244 ||
        info.profile === 44 || info.profile === 83 || info.profile === 86 || info.profile === 118 ||
        info.profile === 128 || info.profile === 144) {

        sps.chroma_format = br.readUE();
        if (sps.chroma_format === 3) br.skip(1);

        sps.bit_depth_luma = br.readUE() + 8;
        sps.bit_depth_chroma = br.readUE() + 8;

        br.skip(1);

        if (br.readU1() !== 0) {

            for (i = 0; i < 8; i++) {

                if (br.readU1() !== 0) {

                    // scaling list
                    var ds, ls = 8, ns = 8;

                    for (j = 0; j < (i < 6 ? 16 : 64); j++) {

                        if (ns) {

                            ds = br.readSE();
                            ns = (ls + ds + 256) % 256;
                        }

                        ls = (ns === 0 ? ls : ns);
                    }
                }
            }
        }

    } else {

        sps.chroma_format = 1;
        sps.bit_depth_luma = 8;
        sps.bit_depth_chroma = 8;
    }

    sps.log2_max_frame_num_minus4 = br.readUE();
    sps.pic_order_cnt_type = br.readUE();

    if (sps.pic_order_cnt_type === 0) br.readUE();
    else if (sps.pic_order_cnt_type === 1) {

        i = br.readUE();
        for (j = 0; j < i; j++) br.readSE();
    }

    sps.num_ref_frames = br.readUE();
    sps.gaps_in_frame_num_value_allowed_flag = br.readU1();
    sps.pic_width_in_mbs_minus1 = br.readUE();
    sps.pic_height_in_map_units_minus1 = br.readUE();
    sps.frame_mbs_only_flag = br.readU1();
    if (sps.frame_mbs_only_flag === 0) sps.mb_adaptive_frame_field_flag = br.readU1();
    sps.direct_8x8_inference_flag = br.readU1();

    if (br.readU1() !== 0) {

        sps.frame_crop_left_offset = br.readUE();
        sps.frame_crop_right_offset = br.readUE();
        sps.frame_crop_top_offset = br.readUE();
        sps.frame_crop_bottom_offset = br.readUE();

        var vsub, hsub, step_x, step_y;

        vsub = (sps.chroma_format === 1 ? 1 : 0);
        hsub = (sps.chroma_format === 1 || sps.chroma_format === 2 ? 1 : 0);

        step_x = 1 << hsub;
        step_y = (2 - sps.frame_mbs_only_flag) << vsub;

        if (sps.frame_crop_left_offset && (0x1F >> (sps.bit_depth_luma > 8)) !== 0)
            sps.frame_crop_left_offset = sps.frame_crop_left_offset & ~(0x1F >> (sps.bit_depth_luma > 8));

        sps.frame_crop_left_offset = sps.frame_crop_left_offset * step_x;
        sps.frame_crop_right_offset = sps.frame_crop_right_offset * step_x;
        sps.frame_crop_top_offset = sps.frame_crop_top_offset * step_y;
        sps.frame_crop_bottom_offset = sps.frame_crop_bottom_offset * step_y;

    } else {

        sps.frame_crop_left_offset = 0;
        sps.frame_crop_right_offset = 0;
        sps.frame_crop_top_offset = 0;
        sps.frame_crop_bottom_offset = 0;
    }

    info.width = ((sps.pic_width_in_mbs_minus1 + 1) * 16);
    info.width -= (sps.frame_crop_left_offset + sps.frame_crop_right_offset);

    info.height = ((sps.pic_height_in_map_units_minus1 + 1) * 16);
    info.height -= (sps.frame_crop_top_offset + sps.frame_crop_bottom_offset);

    if (info.width % 16) info.width = ((info.width / 16) + 1) * 16;
    if (info.height % 2) info.height--;

    br = null;
};


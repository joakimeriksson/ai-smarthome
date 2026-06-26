"""Char->phoneme Transformer seq2seq for Swedish G2P.

Data-agnostic: vocab sizes are passed in, so this file doesn't depend on the
NST lexicon format. Input = Swedish word characters; output = IPA phoneme
tokens (from the voice's inventory, including stress `ˈ ˌ` and length `ː`).

Small by design (~5M params) — G2P is an easy seq2seq task and we want fast
training + CPU-cheap inference for OOV words at synth time.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import torch
import torch.nn as nn

PAD, BOS, EOS = 0, 1, 2  # reserved ids shared by both vocabs


@dataclass
class G2PConfig:
    src_vocab: int          # number of input character ids (incl PAD/BOS/EOS)
    tgt_vocab: int          # number of output phoneme-token ids (incl PAD/BOS/EOS)
    d_model: int = 256
    nhead: int = 4
    num_encoder_layers: int = 3
    num_decoder_layers: int = 3
    dim_feedforward: int = 1024
    dropout: float = 0.1
    max_len: int = 64


class PositionalEncoding(nn.Module):
    def __init__(self, d_model: int, max_len: int):
        super().__init__()
        pe = torch.zeros(max_len, d_model)
        pos = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
        pe[:, 0::2] = torch.sin(pos * div)
        pe[:, 1::2] = torch.cos(pos * div)
        self.register_buffer("pe", pe.unsqueeze(0))  # (1, max_len, d_model)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.pe[:, : x.size(1)]


class G2PTransformer(nn.Module):
    def __init__(self, cfg: G2PConfig):
        super().__init__()
        self.cfg = cfg
        self.src_emb = nn.Embedding(cfg.src_vocab, cfg.d_model, padding_idx=PAD)
        self.tgt_emb = nn.Embedding(cfg.tgt_vocab, cfg.d_model, padding_idx=PAD)
        self.pos = PositionalEncoding(cfg.d_model, cfg.max_len)
        self.transformer = nn.Transformer(
            d_model=cfg.d_model,
            nhead=cfg.nhead,
            num_encoder_layers=cfg.num_encoder_layers,
            num_decoder_layers=cfg.num_decoder_layers,
            dim_feedforward=cfg.dim_feedforward,
            dropout=cfg.dropout,
            batch_first=True,
        )
        self.out = nn.Linear(cfg.d_model, cfg.tgt_vocab)
        self.scale = math.sqrt(cfg.d_model)

    def _pad_mask(self, x: torch.Tensor) -> torch.Tensor:
        return x == PAD  # True where padded

    def forward(self, src: torch.Tensor, tgt_in: torch.Tensor) -> torch.Tensor:
        """src: (B, S) char ids; tgt_in: (B, T) phoneme ids (BOS-shifted).
        Returns logits (B, T, tgt_vocab)."""
        src_pad = self._pad_mask(src)
        tgt_pad = self._pad_mask(tgt_in)
        tgt_mask = nn.Transformer.generate_square_subsequent_mask(
            tgt_in.size(1), device=tgt_in.device
        )
        se = self.pos(self.src_emb(src) * self.scale)
        te = self.pos(self.tgt_emb(tgt_in) * self.scale)
        h = self.transformer(
            se, te,
            tgt_mask=tgt_mask,
            src_key_padding_mask=src_pad,
            tgt_key_padding_mask=tgt_pad,
            memory_key_padding_mask=src_pad,
        )
        return self.out(h)

    @torch.no_grad()
    def greedy_decode(self, src: torch.Tensor, max_len: int | None = None) -> list[list[int]]:
        """Greedy decode a batch. Returns list of phoneme-id lists (no BOS/EOS)."""
        self.eval()
        max_len = max_len or self.cfg.max_len
        device = src.device
        src_pad = self._pad_mask(src)
        memory = self.transformer.encoder(
            self.pos(self.src_emb(src) * self.scale), src_key_padding_mask=src_pad
        )
        B = src.size(0)
        ys = torch.full((B, 1), BOS, dtype=torch.long, device=device)
        done = torch.zeros(B, dtype=torch.bool, device=device)
        for _ in range(max_len):
            tgt_mask = nn.Transformer.generate_square_subsequent_mask(ys.size(1), device=device)
            h = self.transformer.decoder(
                self.pos(self.tgt_emb(ys) * self.scale), memory,
                tgt_mask=tgt_mask, memory_key_padding_mask=src_pad,
            )
            nxt = self.out(h[:, -1]).argmax(-1)
            nxt = nxt.masked_fill(done, PAD)
            ys = torch.cat([ys, nxt.unsqueeze(1)], dim=1)
            done = done | (nxt == EOS)
            if bool(done.all()):
                break
        out = []
        for row in ys[:, 1:].tolist():  # drop BOS
            seq = []
            for t in row:
                if t == EOS:
                    break
                if t not in (PAD, BOS):
                    seq.append(t)
            out.append(seq)
        return out

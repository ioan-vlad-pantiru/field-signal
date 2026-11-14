"""Monthly field-dynamics LSTM: one step predicts the next month's standardised state."""
import torch
from torch import nn

N_STATE = 2
N_WEATHER = 10
N_STATIC = 6
N_CLASSES = 10


class MonthlyModel(nn.Module):
    def __init__(self, n_weather=N_WEATHER, n_static=N_STATIC, emb_dim=8, hidden=128, dropout=0.4):
        super().__init__()
        # one table for crop, prev_crop_1, prev_crop_2: they share the class vocabulary
        self.emb = nn.Embedding(N_CLASSES, emb_dim)
        # 1-layer nn.LSTM(dropout=...) is a no-op, so dropout is applied after the LSTM
        self.lstm = nn.LSTM(N_STATE * 2 + n_weather + 2 + 3 * emb_dim + n_static, hidden,
                            num_layers=1, batch_first=True)
        self.drop = nn.Dropout(dropout)
        self.head = nn.Linear(hidden, N_STATE)

    def forward(self, state, observed, weather, ts, crops, static):
        # state/observed [B,T,2], weather [B,T,10], ts [B,T,2], crops [B,T,3], static [B,6]
        b, t, _ = state.shape
        x = torch.cat([state, observed, weather, ts,
                       self.emb(crops).flatten(-2),
                       static[:, None, :].expand(b, t, -1)], dim=-1)
        h, _ = self.lstm(x)
        return self.head(self.drop(h))

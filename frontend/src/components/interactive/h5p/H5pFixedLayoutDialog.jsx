import React, { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import { scheduleH5pEditorDomCleanup } from '../../../utils/h5pEditorDomCleanup';

export default function H5pFixedLayoutDialog({ open, onClose, onConfirm, initial = {} }) {
  const handleClose = () => {
    onClose();
  };
  const [x, setX] = useState(initial.x ?? 5);
  const [y, setY] = useState(initial.y ?? 10);
  const [width, setWidth] = useState(initial.width ?? 40);
  const [height, setHeight] = useState(initial.height ?? 25);
  const [zIndex, setZIndex] = useState(initial.zIndex ?? 1);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="xs"
      fullWidth
      slotProps={{
        transition: { onExited: scheduleH5pEditorDomCleanup },
      }}
    >
      <DialogTitle>Fixed layout position</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Position this H5P block on the page (percentages of page size).
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <TextField label="X %" type="number" fullWidth size="small" value={x} onChange={(e) => setX(Number(e.target.value))} />
          </Grid>
          <Grid item xs={6}>
            <TextField label="Y %" type="number" fullWidth size="small" value={y} onChange={(e) => setY(Number(e.target.value))} />
          </Grid>
          <Grid item xs={6}>
            <TextField label="Width %" type="number" fullWidth size="small" value={width} onChange={(e) => setWidth(Number(e.target.value))} />
          </Grid>
          <Grid item xs={6}>
            <TextField label="Height %" type="number" fullWidth size="small" value={height} onChange={(e) => setHeight(Number(e.target.value))} />
          </Grid>
          <Grid item xs={12}>
            <TextField label="z-index" type="number" fullWidth size="small" value={zIndex} onChange={(e) => setZIndex(Number(e.target.value))} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button variant="contained" onClick={() => onConfirm({ x, y, width, height, zIndex })}>
          Place block
        </Button>
      </DialogActions>
    </Dialog>
  );
}

import { useEffect, useState, useRef } from 'react';

import { Button } from 'primereact/button';
import { Calendar } from 'primereact/calendar';
import { Checkbox } from 'primereact/checkbox';
import { Dropdown } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { Toolbar } from 'primereact/toolbar';

import { SOURCE_TYPE, BROWSE_MODE, SUPPORTED_BROWSE_MODES, MESSAGE_ORDER } from '../../hooks/solace';

import classes from './styles.module.css';

export default function MessageListToolbar({ sourceDefinition, minTime, maxTime, onChange }) {
  const { type: sourceType, sourceName, config: { id: brokerId } } = sourceDefinition;
  const intervalRef = useRef(null);

  const [sourceLabel, browseModes] =
    (sourceType === SOURCE_TYPE.BASIC) ? [
      'Queue', [
        { value: BROWSE_MODE.HEAD, name: 'Queue Head' }
      ]
    ] : (sourceType === SOURCE_TYPE.QUEUE) ? [
      'Queue', [
        { value: BROWSE_MODE.HEAD, name: 'Queue Head' },
        { value: BROWSE_MODE.TAIL, name: 'Queue End' },
        { value: BROWSE_MODE.TIME, name: 'Date / Time' },
        { value: BROWSE_MODE.MSGID, name: 'Message ID' }
      ]] : (sourceType === SOURCE_TYPE.TOPIC) ? [
        'Topic', [
          { value: BROWSE_MODE.TIME, name: 'Date / Time' },
          { value: BROWSE_MODE.MSGID, name: 'Message ID' }
        ]
      ] : [
      '', [
        { value: null }
      ]
    ];

  const [minDate, maxDate] = [new Date(minTime * 1000), new Date(maxTime * 1000)];

  const [browseMode, setBrowseMode] = useState(browseModes[0].value);
  const [calendarVisible, setCalendarVisible] = useState(false);

  // Browse Start Points
  const [basicMode, setBasicMode] = useState(false);
  const [dateTime, setDateTime] = useState(null);
  const [msgId, setMsgId] = useState('');

  const basicSource = (sourceType === SOURCE_TYPE.BASIC);

  const getFromTime = () => {
    try {
      const fromTime = dateTime ? Math.floor(Date.parse(dateTime) / 1000) : null;
      return ({ fromTime });
    } catch {
      console.error('Invalid date format'); //TODO: send toast notification
      return ({ fromTime: null });
    }
  }

  const getFromMsgId = () => {
    try {
      const fromMsgId = msgId.startsWith('rmid1:') ?
        window.parseInt(msgId.substring(24).replace('-', ''), 16) :
        window.parseInt(msgId);
      return ((fromMsgId > 0) ? { fromMsgId } : { fromTime: null });
    } catch {
      console.error('Invalid message id'); //TODO: send toast notification
      return ({ fromTime: null });
    }
  }

  useEffect(() => {
    const coercedBrowseMode =
      (basicSource) ?
        BROWSE_MODE.HEAD :
        (!SUPPORTED_BROWSE_MODES[sourceType].includes(browseMode)) ?
          SUPPORTED_BROWSE_MODES[sourceType][0] :
          browseMode;

    if (browseMode !== coercedBrowseMode) {
      setBrowseMode(coercedBrowseMode);
    }
    raiseOnChange(coercedBrowseMode);

    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      raiseOnChange(browseMode);
    }, 30 * 1000); // refresh every 30 seconds
  
    return () => clearInterval(intervalRef.current);
  }, [brokerId, sourceType, sourceName, browseMode, basicMode, dateTime, msgId]); // Dependencias para re-ejecutar el efecto


  const raiseOnChange = (browseMode) => {
    if (basicMode || basicSource) {
      onChange({ browseMode: BROWSE_MODE.BASIC });
      return;
    }

    switch (browseMode) {
      case BROWSE_MODE.BASIC:
      case BROWSE_MODE.HEAD:
        onChange({ browseMode, startFrom: { queuePosition: MESSAGE_ORDER.OLDEST } });
        break;
      case BROWSE_MODE.TAIL:
        onChange({ browseMode, startFrom: { queuePosition: MESSAGE_ORDER.NEWEST } });
        break;
      case BROWSE_MODE.TIME:
        onChange({ browseMode, startFrom: getFromTime() });
        break;
      case BROWSE_MODE.MSGID:
        onChange({ browseMode, startFrom: getFromMsgId() });
        break;
    }
  };

  const handleBrowseModeChange = ({ value: mode }) => {
    setBrowseMode(mode);
    raiseOnChange(mode);
  };

  const handleCalendarVisibleChangle = async () => {
    if (calendarVisible) {
      setCalendarVisible(false);
    } else {
      setCalendarVisible(true);
    }
  };

  const handleBasicModeChange = (e) => {
    setBasicMode(e.checked);
  };

  const handleCalendarChange = (e) => {
    setDateTime(e.value);
  };

  const handleMsgIdTextChange = (e) => {
    setMsgId(e.target.value);
  }

  const handleRefreshClick = () => {
    raiseOnChange(browseMode);
  };

  return (
    <Toolbar className={classes.messageListToolbar}
      start={() => <h3>{sourceLabel} | {sourceName}</h3>}
      end={() =>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label>From:</label>
          <Dropdown value={browseMode} onChange={handleBrowseModeChange} options={browseModes} optionLabel="name" disabled={basicSource} />
          {
            ([BROWSE_MODE.HEAD, BROWSE_MODE.BASIC].includes(browseMode)) ?
              <div style={{ display: 'flex', width: 188 }}>
                <Checkbox inputId="simpleBrowser" onChange={handleBasicModeChange} checked={basicMode || basicSource} disabled={basicSource} />
                <label htmlFor="simpleBrowser" className="ml-2">Basic Mode</label>
              </div> :
              (browseMode === BROWSE_MODE.TAIL) ?
                <div style={{ display: 'flex', width: 188 }}></div> :
                (browseMode === BROWSE_MODE.MSGID) ?
                  <InputText placeholder="ID or RGMID" value={msgId} onChange={handleMsgIdTextChange} /> :
                  (browseMode === BROWSE_MODE.TIME) ?
                    <Calendar placeholder="Beginning of log" visible={calendarVisible} value={dateTime} showTime
                      onVisibleChange={handleCalendarVisibleChangle} onChange={handleCalendarChange} minDate={minDate} maxDate={maxDate}
                    /> :
                    <InputText disabled={true} placeholder="Invalid browse mode" />
          }
          <Button onClick={handleRefreshClick} size="small">Refresh</Button>
        </div>}
    />
  );
}
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { Toolbar } from 'primereact/toolbar';
import { FloatLabel } from 'primereact/floatlabel';
import { InputText } from 'primereact/inputtext'
import { Password } from 'primereact/password';
import { Checkbox } from 'primereact/checkbox';
import { Toast } from 'primereact/toast'

import classes from './styles.module.css';
import { useEffect, useState, useRef } from 'react';
        
export default function BrokerConfigDialog( { config, brokerEditor, onHide }) {
  const visible = (config !== null);
  const [values, setValues] = useState({});
  const toast = useRef(null);

  useEffect(() => {
    setValues({
      id: 0,
      displayName: '',
      hostName: 'localhost',
      clientPort: '8008',
      sempPort: '8080',
      useTls: false,
      vpn: 'default',
      clientUsername: 'default',
      clientPassword: '',
      sempUsername: 'admin',
      sempPassword: '',
      ...(config || {})
    });
  }, [config]);

  const handleInputChange = (evt) => {
    setValues({ ...values, [evt.target.id] : 
      (evt.target.type === 'checkbox') ? 
        evt.target.checked :
        evt.target.value 
    });
  };

  const handleSave = () => {
    brokerEditor.save(values);
    onHide?.();
  };

  const handleDelete = () => {
    brokerEditor.delete(values);
    onHide?.();
  };

  const handleHide = () => {
    onHide?.();
  }

  const handleTestConnection = async () => {
    const { message } = await brokerEditor.test(values);
    toast.current.show(message);
  }

  const Header = () => (
    (!visible) ? null :
    (values.id) ? 
      <>Edit Broker</> :
      <>Add New Broker</>
  );

  const Footer = () => (
    <Toolbar
      start={
        (values.id) ?
          <Button severity="danger" onClick={handleDelete}>Delete</Button> :
          null
      } 
      end={
        <>
          <Button outlined severity="secondary" onClick={handleTestConnection}>Test Connection</Button>
          <Button onClick={handleSave}>Save</Button>
        </>
      }
    />
  );
  return (
    <Dialog 
      className={classes.formDialog}
      header={Header}
      footer={Footer}
      maskStyle={{ position: 'absolute', borderRadius: 6 }}
      visible={visible}
      onHide={handleHide}
    >
      <Toast ref={toast} />
      <form autoComplete="off">
        <FloatLabel className={classes.formField}>
          <InputText id="displayName" className={classes.formInput} value={values.displayName} onChange={handleInputChange} />
          <label htmlFor="displayName">Display Name</label>
        </FloatLabel>
        <FloatLabel className={classes.formField}>
            <InputText id="hostName" className={classes.formInput} value={values.hostName} onChange={handleInputChange} />
            <label htmlFor="hostName">Hostname</label>
        </FloatLabel>
        <div className={classes.formField} style={{display:'flex', gap: '0.6rem'}}>
          <FloatLabel style={{flex: 1}}>
              <InputText id="clientPort" className={classes.formInput} value={values.clientPort} onChange={handleInputChange} />
              <label htmlFor="clientPort">WS Port</label>
          </FloatLabel>
          <FloatLabel style={{flex: 1}}>
              <InputText id="sempPort" className={classes.formInput} value={values.sempPort} onChange={handleInputChange} />
              <label htmlFor="sempPort">SEMP Port</label>
          </FloatLabel>
          <div style={{flex: 1}}>
            <Checkbox id="useTls" onChange={handleInputChange} checked={values.useTls} style={{height:'100%', paddingTop:'0.5rem'}}/>
            <label htmlFor="useTls" className={classes.checkboxLabel}>Use TLS</label>
          </div>
        </div>
        <FloatLabel className={classes.formField}>
            <InputText id="vpn" className={classes.formInput} value={values.vpn} onChange={handleInputChange} />
            <label htmlFor="vpn">VPN</label>
        </FloatLabel>
        <FloatLabel className={classes.formField}>
            <InputText id="clientUsername" className={classes.formInput} value={values.clientUsername} onChange={handleInputChange} />
            <label htmlFor="clientUsername">Client Username</label>
        </FloatLabel>
        <FloatLabel className={classes.formField}>
            <Password inputId="clientPassword" className={classes.passwordInput} feedback={false} value={values.clientPassword} onChange={handleInputChange} />
            <label htmlFor="clientPassword">Client Password</label>
        </FloatLabel>
        <FloatLabel className={classes.formField}>
            <InputText id="sempUsername" className={classes.formInput} value={values.sempUsername} onChange={handleInputChange} />
            <label htmlFor="sempUsername">SEMP Username</label>
        </FloatLabel>
        <FloatLabel className={classes.formField}>
            <Password inputId="sempPassword" className={classes.passwordInput} feedback={false} value={values.sempPassword} onChange={handleInputChange} />
            <label htmlFor="sempPassword">SEMP Password</label>
        </FloatLabel> 
      </form>
    </Dialog>
  );
}
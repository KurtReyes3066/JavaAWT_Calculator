import java.awt.*;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;

public class  Reyes implements ActionListener{

    Frame f;
    TextField tf;
   
    Button[] numbt= new Button[10];
    Button[] funcbt= new Button[6];
    Button addbt,subbt,mulbt,divbt;
    Button clrbt,equbt;
    Panel p;
    Font ft = new Font("Calibri", Font.BOLD,35);

    double num1=0,num2=0,result=0;
    char operator;

    public Reyes() {
    Color yellow= new Color(50-0-150);
        
        f = new Frame("Calculator");
        f.setSize(400,430);
        f.setResizable(false);
        f.setLayout(null);

        tf = new TextField();
        tf.setBounds(50,50,300,50);
        tf.setFont(ft);
        tf.setEditable(false);
        
        addbt = new Button("+");
        subbt = new Button("-");
        mulbt = new Button("×");
        divbt = new Button("÷ ");
        clrbt = new Button ("C");
        equbt = new Button ("=");

        funcbt[0]= addbt;
        funcbt[1]= subbt;
        funcbt[2]= mulbt;
        funcbt[3]= divbt;
        funcbt[4]= clrbt;
        funcbt[5]= equbt;

        for (int i = 0; i < 6; i++) {
            funcbt[i].addActionListener(this);
            funcbt[i].setFont(ft);
            funcbt[i].setFocusable(false);
        }
        for (int i = 0; i < 10; i++) {
            numbt[i] = new Button(String.valueOf(i));
            numbt[i].addActionListener(this);
            numbt[i].setFont(ft);
            numbt[i].setFocusable(false);
        }

        p = new Panel();
        p.setBounds(50,120,300,250);
        p.setLayout(new GridLayout(4,4,10,10));
        p.setBackground(Color.pink);
        p.add(numbt[1]);
        p.add(numbt[2]);
        p.add(numbt[3]);
        p.add(clrbt);
        p.add(numbt[4]);
        p.add(numbt[5]);
        p.add(numbt[6]);
        p.add(addbt);
        p.add(numbt[7]);
        p.add(numbt[8]);
        p.add(numbt[9]);
        p.add(subbt);
        p.add(numbt[0]);
        p.add(mulbt);
        p.add(divbt);
        p.add(equbt);

        equbt.setBackground(yellow);
        clrbt.setForeground(Color.red);
        f.setBackground(Color.PINK);
        f.add(tf);
        f.add(p);
        f.setVisible(true);
        
    }

    public static void main(String[] args) {
        Reyes reyes = new Reyes();
    }

    @Override
    public void actionPerformed(ActionEvent e) {
       
		
            for(int i=0;i<10;i++) {
                if(e.getSource() == numbt[i]) {
                    tf.setText(tf.getText().concat(String.valueOf(i)));
                }
            }
           
            if(e.getSource()==addbt) {
                num1 = Double.parseDouble(tf.getText());
                operator ='+';
                tf.setText("");
            }
            if(e.getSource()==subbt) {
                num1 = Double.parseDouble(tf.getText());
                operator ='-';
                tf.setText("");
            }
            if(e.getSource()==mulbt) {
                num1 = Double.parseDouble(tf.getText());
                operator ='*';
                tf.setText("");
            }
            if(e.getSource()==divbt) {
                num1 =  Double.parseDouble(tf.getText());
                operator ='/';
                tf.setText("");
            }
            if(e.getSource()==equbt) {
                num2= Double.parseDouble(tf.getText());
                
                switch(operator) {
                case'+':
                    result=num1+num2;
                    break;
                case'-':
                    result=num1-num2;
                    break;
                case'*':
                    result=num1*num2;
                    break;
                case'/':
                    result=num1/num2;
                    break;
                }
                tf.setText(String.valueOf(result));
                num1=result;
            }
            if(e.getSource()==clrbt) {
                tf.setText("");
            }
           
            }
           
           
        
        }
       
